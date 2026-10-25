// Ablauf der App: PDF öffnen → automatisch prüfen → pro Fund entscheiden → anwenden → vergleichen → speichern.

import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { parseCommand, findMatches, valueKey, normalize, SHORT } from './detect.js';
import { buildPageModel, segmentsForRange, findImages } from './pdfmodel.js';
import { analyzeDocument } from './structure.js';
import { redactPdf, verifyResult } from './redact.js';
import { PageViewer } from './viewer.js';
import { PseudonymTable, Pseudonymizer } from './pseudo.js';
import { TemplateStore, fingerprint, findingSignature, typeKey, hintHash, findHashedTerms } from './templates.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const PDF_OPTS = {
  cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
  isEvalSupported: false,
  enableXfa: false,
};

const $ = (id) => document.getElementById(id);
const ui = {
  open: $('btnOpen'), open2: $('btnOpen2'), fileInput: $('fileInput'), fileName: $('fileName'),
  empty: $('empty'), viewer: $('viewer'), toolbar: $('toolbar'), spacer: $('spacer'),
  zoom: $('btnZoom'), mark: $('btnMark'), tabOriginal: $('tabOriginal'), tabResult: $('tabResult'), pageInfo: $('pageInfo'),
  sheet: $('sheet'), sheetHead: $('sheetHead'), summary: $('summary'), primary: $('btnPrimary'), scrim: $('scrim'),
  body: $('sheetBody'), verify: $('verify'), hintForm: $('hintForm'), hintInput: $('hintInput'),
  filters: $('filters'), bulk: $('bulk'), list: $('findings'),
  saveDlg: $('saveDlg'), saveName: $('saveName'), saveHint: $('saveHint'),
  settings: $('settings'), btnSettings: $('btnSettings'), setDefault: $('setDefault'), setLow: $('setLow'), setSender: $('setSender'),
  setDpi: $('setDpi'), setRasterAll: $('setRasterAll'), tableBox: $('tableBox'), templateBox: $('templateBox'),
  btnExport: $('btnExport'), btnImport: $('btnImport'), btnClearTable: $('btnClearTable'), importInput: $('importInput'),
  toast: $('toast'),
};

// ---------------------------------------------------------------------------
// Zustand und Einstellungen
// ---------------------------------------------------------------------------

const state = {
  file: null, // { name, bytes, handle }
  doc: null,
  models: [],
  findings: [],
  notices: [],
  result: null, // { bytes, doc, report, stats }
  stale: false,
  view: 'original',
  filter: 'alle',
  busy: false,
  hints: [], // angewendete Hinweise (für Schablonen)
  templateOffer: null, // { template, score, dismissed, applied }
  templateId: null,
};

const SETTINGS_KEY = 'pdfprivacy.settings';
const settings = (() => {
  const def = { defaultAction: 'redact', preselectLow: false, preselectSender: false, dpi: 200, rasterAll: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
})();
function storeSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* privater Modus */ }
}

const table = new PseudonymTable();
const templates = new TemplateStore();
let pseudo = new Pseudonymizer(table);

const viewer = new PageViewer(ui.viewer, {
  onChange: renderToolbar,
  onTapShape: (id) => { const f = findingByShape(id); if (f) { state.focusId = f.id; renderOverlays(); focusFinding(f); } },
  onDraw: addManualArea,
});

let seq = 0;
const nextId = () => `f${++seq}`;

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return e;
}

let toastTimer;
function toast(text, ms = 3200) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidden = true), ms);
}

function busy(text) {
  ui.summary.replaceChildren(el('span', { class: 'busy-line' }, text));
}

function reportError(e, msg = 'Fehler') {
  console.error(e);
  toast(`${msg}${e?.message ? ` (${e.message})` : ''}`, 6000);
}

const isDesktop = () => matchMedia('(min-width: 900px)').matches;

// ---------------------------------------------------------------------------
// Dokument öffnen und automatisch prüfen
// ---------------------------------------------------------------------------

async function pickFile() {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      await openFile(await handle.getFile(), handle);
    } catch (e) {
      if (e.name !== 'AbortError') reportError(e);
    }
    return;
  }
  ui.fileInput.value = '';
  ui.fileInput.click();
}

async function openFile(file, handle = null) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const task = pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() });
    task.onPassword = (cb, reason) => {
      const pw = prompt(reason === 2 ? 'Falsches Passwort. Bitte erneut eingeben:' : 'Dieses PDF ist passwortgeschützt. Passwort:');
      if (pw === null) task.destroy(); else cb(pw);
    };
    const doc = await task.promise;

    await clearResult();
    await state.doc?.destroy();
    Object.assign(state, { file: { name: file.name || 'dokument.pdf', bytes, handle }, doc, models: [], findings: [], notices: [], filter: 'alle', hints: [], templateOffer: null, templateId: null });
    pseudo = new Pseudonymizer(table);
    ui.fileName.textContent = state.file.name;
    ui.empty.hidden = true;
    for (const x of [ui.viewer, ui.toolbar, ui.sheet, ui.spacer]) x.hidden = false;
    setView('original');
    await viewer.setDocument(doc);

    for (let i = 1; i <= doc.numPages; i++) {
      busy(`Lese Seite ${i} von ${doc.numPages} …`);
      state.models.push(await buildPageModel(await doc.getPage(i)));
    }
    busy('Suche nach kritischen Daten …');
    await analyze();
  } catch (e) {
    reportError(e, 'Das PDF konnte nicht geöffnet werden.');
  }
}

function texts() {
  return state.models.map((m) => m.text);
}

function defaultAction(f) {
  if (f.cat === 'image') return 'keep';
  if (f.owner === 'sender' && !settings.preselectSender) return 'keep';
  if (f.known) return 'replace';
  if (f.risk === 'niedrig' && !settings.preselectLow) return 'keep';
  return settings.defaultAction;
}

/** Fund aus Textstellen aufbauen (inkl. Flächen zum Markieren). */
function makeFinding(base) {
  const f = { id: nextId(), variants: [], ...base };
  for (const o of f.occurrences) {
    if (!o.segments) o.segments = segmentsForRange(state.models[o.page], o.start, o.end);
    o.quads = o.segments.map((s) => s.quad);
  }
  return f;
}

async function analyze() {
  const found = analyzeDocument(state.models).map((g) => makeFinding(g));

  // Bilder: mögliche Unterschriften, Fotos, Stempel; ganzseitige Bilder = Scan
  for (let i = 0; i < state.doc.numPages; i++) {
    const page = await state.doc.getPage(i + 1);
    const imgs = await findImages(page, pdfjsLib.OPS).catch(() => []);
    const textLen = state.models[i].text.trim().length;
    for (const img of imgs) {
      if (img.share > 0.6) {
        if (textLen < 40) state.notices.push(`Seite ${i + 1} ist ein Scan (Bild ohne Text). Inhalte darauf kann die App nicht lesen – bitte selbst prüfen und mit ▭ markieren.`);
        continue;
      }
      found.push(makeFinding({
        cat: 'image', label: 'Bild', risk: 'niedrig',
        value: `Bild auf Seite ${i + 1} (${Math.max(1, Math.round(img.share * 100))} % der Seite)`,
        note: 'Unterschrift, Foto, Stempel oder Logo? Bitte ansehen.',
        occurrences: [{ page: i, segments: [{ quad: img.quad }], text: '' }],
      }));
    }
  }
  if (!state.models.some((m) => m.text.trim()) && !state.notices.length) {
    state.notices.push('Dieses PDF enthält keinen lesbaren Text (eingescannt?). Bitte Bereiche mit ▭ von Hand markieren.');
  }

  for (const f of found) {
    await pseudo.prepare(f);
    f.action = defaultAction(f);
    f.sigBase = await findingSignature(f, state.models, table.data.salt);
  }
  state.findings = found;
  // Bekanntes Formular? Dann die gespeicherte Bearbeitung anbieten
  const fp = await fingerprint(state.models, found, table.data.salt);
  const match = templates.match(fp);
  state.templateOffer = match ? { template: match.template, score: match.score } : null;
  changed();
  if (!isDesktop() && found.length) openSheet(true);
}

// ---------------------------------------------------------------------------
// Funde ändern
// ---------------------------------------------------------------------------

function setAction(f, action) {
  if (action === 'replace' && !f.fake) return toast('Für diesen Fund gibt es keinen Ersatzwert – bitte schwärzen.');
  f.action = action;
  changed();
}

/** Gleiche Merkmale (z. B. mehrere Datumszellen einer Tabelle) nach Reihenfolge unterscheiden. */
function assignSignatures() {
  const pos = (f) => { const o = f.occurrences[0] || {}; return (o.page || 0) * 1e7 + (o.start ?? 0); };
  const seen = new Map();
  for (const f of [...state.findings].sort((a, b) => pos(a) - pos(b))) {
    if (!f.sigBase) continue;
    const k = seen.get(f.sigBase) || 0;
    seen.set(f.sigBase, k + 1);
    f.sig = `${f.sigBase}#${k}`;
  }
}

function manualFinding(page, quad) {
  const n = state.findings.filter((f) => f.cat === 'manual').length + 1;
  const m = state.models[page];
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const f = makeFinding({
    cat: 'manual', label: 'Markierter Bereich', risk: 'hoch', owner: 'person', value: `Bereich ${n} auf Seite ${page + 1}`,
    occurrences: [{ page, segments: [{ quad }], text: '' }],
    // Lage relativ zur Seite – für Schablonen
    rel: [Math.min(...xs) / m.width, Math.min(...ys) / m.height, Math.max(...xs) / m.width, Math.max(...ys) / m.height],
  });
  f.action = 'redact';
  return f;
}

async function addManualArea(page, quad) {
  const f = manualFinding(page, quad);
  f.sigBase = await findingSignature(f, state.models, table.data.salt);
  state.findings.unshift(f);
  changed();
  toast('Bereich wird geschwärzt. Weitere Bereiche ziehen oder ▭ beenden.');
}

/**
 * Treffer eines Hinweises übernehmen: vorhandene Funde aktivieren bzw. behalten, neue Funde anlegen.
 * hits: [{page, start, end, text}], cat: Kategorie oder 'hint'.
 */
async function applyHits(hits, { cat = 'hint', keep = false } = {}) {
  let added = 0, changedCount = 0;
  if (keep) {
    for (const f of state.findings) {
      const hit = (cat !== 'hint' && f.cat === cat) || hits.some((h) => f.occurrences.some((o) => o.page === h.page && o.start < h.end && h.start < o.end));
      if (hit && f.action !== 'keep') { f.action = 'keep'; changedCount++; }
    }
    return { added, changedCount };
  }
  const fresh = [];
  for (const h of hits) {
    const owner = state.findings.find((f) => f.occurrences.some((o) => o.page === h.page && o.start < h.end && h.start < o.end));
    if (owner) {
      if (owner.action === 'keep') { owner.action = owner.fake && settings.defaultAction === 'replace' ? 'replace' : 'redact'; changedCount++; }
    } else fresh.push(h);
  }
  const groups = new Map();
  for (const h of fresh) {
    const key = valueKey(cat, h.text);
    if (!groups.has(key)) groups.set(key, { cat, label: cat !== 'hint' ? SHORT[cat] : 'Dein Hinweis', risk: 'hoch', owner: 'person', occurrences: [] });
    groups.get(key).occurrences.push({ page: h.page, start: h.start, end: h.end, text: h.text });
  }
  for (const g of groups.values()) {
    const vals = [...new Set(g.occurrences.map((o) => o.text.replace(/\s+/g, ' ').trim()))];
    g.value = vals.reduce((a, b) => (b.length > a.length ? b : a));
    g.variants = vals.filter((v) => v !== g.value);
    const f = makeFinding(g);
    await pseudo.prepare(f);
    f.action = f.known ? 'replace' : settings.defaultAction === 'replace' && f.fake ? 'replace' : 'redact';
    f.sigBase = await findingSignature(f, state.models, table.data.salt);
    state.findings.unshift(f);
    added++;
  }
  return { added, changedCount };
}

/** Hinweise des Nutzers: zusätzliche Begriffe/Kategorien oder „behalte …“. */
async function applyHint(text) {
  text = text.trim();
  if (!text || !state.doc) return;
  const keepMatch = text.match(/^(?:bitte\s+)?(?:behalte|behalten|nicht schwärzen|nicht ändern|ignoriere|ignorieren|lass|lasse)\s+(.+)$/i);
  const cmd = parseCommand(keepMatch ? keepMatch[1] : text);
  if (cmd.action === 'apply') return primaryAction();
  if (cmd.action === 'save') { if (cmd.saveName) ui.saveName.value = cmd.saveName; return primaryAction(); }
  if (cmd.action !== 'add') return toast(`Nicht verstanden: „${text}“`);

  let added = 0, changedCount = 0;
  for (const rule of cmd.rules) {
    const hits = findMatches(rule, texts());
    const cat = rule.kind === 'category' ? rule.cat : 'hint';
    const r = await applyHits(hits, { cat, keep: !!keepMatch });
    added += r.added;
    changedCount += r.changedCount;
    // Für Schablonen merken – Begriffe nur als Fingerabdruck
    state.hints.push(rule.kind === 'category'
      ? { kind: 'cat', cat: rule.cat, keep: !!keepMatch }
      : { kind: 'term', hash: await hintHash(rule.term, table.data.salt), words: rule.term.trim().split(/\s+/).length, keep: !!keepMatch });
  }
  ui.hintInput.value = '';
  state.filter = 'alle';
  changed();
  if (added || changedCount) toast(keepMatch ? `${changedCount} Fund(e) bleiben unverändert.` : `${added} neue Fund(e)${changedCount ? `, ${changedCount} geändert` : ''}.`);
  else toast('Dazu wurde im Dokument nichts gefunden.');
  if (added) ui.list.querySelector('.finding')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------
// Bearbeitungsschablonen
// ---------------------------------------------------------------------------

/** Vorschlag für den Namen: Absender + Überschrift, ohne Zahlen. */
function guessTemplateName() {
  const sender = state.findings.find((f) => f.cat === 'block' && f.owner === 'sender');
  let org = sender ? sender.value.split('\n')[0].split(/\s[·|•]\s|,\s/)[0] : '';
  const m = state.models[0];
  const lines = (m?.lines || []).filter((l) => l.x0 !== null && /\p{L}{4}/u.test(l.text) && l.y < m.height * 0.5);
  const heading = lines.filter((l) => !state.findings.some((f) => f.occurrences.some((o) => o.page === 0 && o.start < l.end && l.start < o.end)))
    .sort((a, b) => b.size - a.size)[0];
  const clean = (t) => (t || '').replace(/\d[\d./-]*/g, '').replace(/\s+/g, ' ').trim();
  org = clean(org);
  const head = clean(heading?.text);
  return [org, head].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' – ').slice(0, 70) || 'Meine Schablone';
}

function renderTemplateOffer() {
  const o = state.templateOffer;
  if (!o || o.dismissed) return [];
  if (o.applied) {
    return [el('li', { class: 'offer' }, el('b', {}, `✓ Schablone „${o.template.name}“ angewendet`),
      `${o.applied} Schritte übernommen. Bitte kurz prüfen – neue Funde behalten ihren Vorschlag.`)];
  }
  return [el('li', { class: 'offer' },
    el('b', {}, `Bekanntes Formular: „${o.template.name}“`),
    `${Math.round(o.score * 100)} % Übereinstimmung. Soll die gespeicherte Bearbeitung (${Object.keys(o.template.rules).length + o.template.areas.length + o.template.hints.length} Schritte) übernommen werden?`,
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'btn primary', onclick: () => applyTemplate(o.template) }, 'Schablone anwenden'),
      el('button', { type: 'button', class: 'btn', onclick: () => { o.dismissed = true; renderList(); } }, 'Nein'),
    ),
  )];
}

async function applyTemplate(t) {
  let n = 0;
  assignSignatures();
  for (const f of state.findings) {
    const rule = (f.sig && t.rules[f.sig]) || (f.sigBase && t.baseRules?.[f.sigBase]) || null;
    const action = rule?.action || t.types[typeKey(f)];
    if (!action) continue;
    if (rule?.owner) f.owner = rule.owner;
    f.action = action === 'replace' && !f.fake ? 'redact' : action;
    n++;
  }
  for (const a of t.areas || []) {
    const m = state.models[a.page];
    if (!m) continue;
    const [x0, y0, x1, y1] = [a.rel[0] * m.width, a.rel[1] * m.height, a.rel[2] * m.width, a.rel[3] * m.height];
    const f = manualFinding(a.page, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    f.sigBase = await findingSignature(f, state.models, table.data.salt);
    state.findings.unshift(f);
    n++;
  }
  const terms = (t.hints || []).filter((h) => h.kind === 'term');
  if (terms.length) {
    const hits = await findHashedTerms(texts(), terms, table.data.salt);
    for (const keep of [false, true]) {
      const r = await applyHits(hits.filter((h) => !!h.keep === keep), { keep });
      n += r.added + r.changedCount;
    }
  }
  for (const h of (t.hints || []).filter((x) => x.kind === 'cat')) {
    const r = await applyHits(findMatches({ kind: 'category', cat: h.cat }, texts()), { cat: h.cat, keep: h.keep });
    n += r.added + r.changedCount;
  }
  state.hints = [...(t.hints || [])];
  state.templateId = t.id;
  templates.touch(t.id);
  state.templateOffer = { template: t, applied: n };
  changed();
  toast(`Schablone angewendet: ${n} Schritte.`);
}

async function saveTemplate() {
  const existing = state.templateId && templates.get(state.templateId);
  let id = null, name;
  if (existing && confirm(`Schablone „${existing.name}“ mit dieser Bearbeitung aktualisieren?\n\n(Abbrechen = als neue Schablone speichern)`)) {
    id = existing.id;
    name = existing.name;
  } else {
    name = prompt('Name der Schablone (z. B. Absender und Dokumentart):', guessTemplateName());
    if (!name) return;
  }
  assignSignatures();
  const fp = await fingerprint(state.models, state.findings, table.data.salt);
  const t = templates.upsert({ id, name: name.trim(), fp, findings: state.findings, hints: state.hints });
  state.templateId = t.id;
  toast(`Schablone „${t.name}“ gespeichert. Beim nächsten Dokument dieser Art wird sie angeboten.`, 4500);
  renderReport();
}

// ---------------------------------------------------------------------------
// Anzeige: Zusammenfassung, Liste, Markierungen
// ---------------------------------------------------------------------------

function counts() {
  const c = { redact: 0, replace: 0, keep: 0 };
  for (const f of state.findings) c[f.action]++;
  return c;
}

function changed() {
  if (state.result) {
    state.stale = true;
    ui.tabResult.classList.add('stale');
  }
  renderSummary();
  renderList();
  renderOverlays();
}

function renderSummary() {
  const c = counts();
  const n = state.findings.length;
  ui.summary.replaceChildren();
  if (state.result && !state.stale) {
    const ok = state.result.report.ok;
    ui.summary.append(el('span', { class: ok ? 'ok' : 'bad' }, ok ? '✓ Fertig und geprüft' : '✗ Bitte Prüfbericht ansehen'));
  } else {
    ui.summary.append(el('b', {}, n ? `${n} Fund${n === 1 ? '' : 'e'}` : 'Keine Funde'));
  }
  if (c.redact) ui.summary.append(el('span', { class: 'pill redact' }, `■ ${c.redact} schwärzen`));
  if (c.replace) ui.summary.append(el('span', { class: 'pill replace' }, `⇄ ${c.replace} ersetzen`));
  if (c.keep) ui.summary.append(el('span', { class: 'pill' }, `${c.keep} behalten`));

  const done = state.result && !state.stale;
  ui.primary.textContent = done ? 'Speichern' : state.result ? 'Änderungen anwenden' : 'Anwenden';
  ui.primary.disabled = state.busy || (!done && !c.redact && !c.replace);
}

const OWNER_FILTERS = [['alle', 'Alle'], ['person', 'Deine Daten'], ['sender', 'Absender']];
const ownerOfFinding = (f) => f.owner || 'person';

function renderList() {
  const count = (k) => state.findings.filter((f) => k === 'alle' || ownerOfFinding(f) === k).length;
  ui.filters.replaceChildren(
    ...OWNER_FILTERS.filter(([k]) => k === 'alle' || count(k)).map(([k, label]) => el('button', {
      type: 'button', class: state.filter === k ? 'on' : '',
      onclick: () => { state.filter = k; renderList(); },
    }, `${label} ${count(k)}`)),
  );
  ui.bulk.hidden = state.findings.length < 2;

  const visible = state.findings.filter((f) => state.filter === 'alle' || ownerOfFinding(f) === state.filter);
  const person = visible.filter((f) => ownerOfFinding(f) === 'person');
  const sender = visible.filter((f) => ownerOfFinding(f) === 'sender');
  ui.list.replaceChildren(
    ...renderTemplateOffer(),
    ...state.notices.map((t) => el('li', { class: 'notice' }, '⚠︎ ', t)),
    person.length && sender.length ? el('li', { class: 'section' }, `Deine Daten · ${person.length}`) : null,
    ...person.map(renderFinding),
    sender.length ? el('li', { class: 'section' }, `Absender & Organisationen · ${sender.length}`,
      el('span', { class: 'hint' }, settings.preselectSender ? '' : 'standardmäßig behalten')) : null,
    ...sender.map(renderFinding),
  );
  if (!state.findings.length && state.doc) {
    ui.list.append(el('li', { class: 'nothing' }, 'Keine kritischen Daten erkannt. Ergänze per Hinweis oder markiere Bereiche mit ▭.'));
  }
}

function renderFinding(f) {
  const where = [...new Set(f.occurrences.map((o) => o.page + 1))];
  const times = f.cat === 'block' ? f.instances || 1 : f.occurrences.length;
  const canReplace = !!f.fake;
  const sender = ownerOfFinding(f) === 'sender';
  const actions = [['redact', 'Schwärzen'], ...(canReplace ? [['replace', 'Ersetzen']] : []), ['keep', f.cat === 'manual' ? 'Entfernen' : 'Behalten']];
  const mono = /\d/.test(f.value) && f.cat !== 'block' && f.occurrences[0].text;
  return el('li', { class: `finding r-${sender ? 'sender' : f.risk}${f.cat === 'block' ? ' block' : ''}`, dataset: { id: f.id } },
    el('div', { class: 'meta' },
      el('span', { class: 'risk' }, sender ? 'Absender' : f.risk),
      el('span', {}, f.label),
      el('span', { class: 'where' }, `S. ${where.join(', ')}${times > 1 ? ` · ${times}×` : ''}`),
    ),
    el('button', {
      type: 'button', class: `value${mono ? '' : ' text'}`, title: 'Im Dokument zeigen',
      onclick: () => showInDocument(f),
    }, f.value),
    f.variants.length ? el('div', { class: 'variants' }, `auch: ${f.variants.join(' · ')}`) : null,
    f.note ? el('div', { class: 'note' }, f.note) : null,
    el('div', { class: `choice${actions.length === 2 ? ' two' : ''}` },
      actions.map(([a, label]) => el('button', {
        type: 'button', class: f.action === a ? 'on' : '', dataset: { a },
        onclick: () => (f.cat === 'manual' && a === 'keep' ? removeFinding(f) : setAction(f, a)),
      }, label)),
    ),
    canReplace ? el('div', { class: `fake${f.action === 'replace' ? '' : ' off'}` },
      el('span', { class: 'arrow' }, f.action === 'replace' ? 'wird zu' : 'Ersatz wäre'),
      el('code', {}, f.fake),
      f.known ? el('span', { class: 'known', title: 'Aus deiner Pseudonym-Tabelle' }, 'bekannt') : null,
      el('button', { type: 'button', class: 'dice', 'aria-label': 'Anderen Ersatzwert erzeugen', onclick: () => regenerateFake(f) }, '🎲'),
    ) : null,
    ['manual', 'image'].includes(f.cat) ? null : el('button', {
      type: 'button', class: 'owner-switch', onclick: () => switchOwner(f),
    }, sender ? '↺ Gehört zu meinen Daten' : '↺ Gehört zum Absender'),
  );
}

async function regenerateFake(f) {
  await pseudo.regenerate(f);
  await refreshFakes();
  changed();
}

/** Nach dem Neu-Würfeln: alle Funde mit gleichen Bestandteilen (Namen, Adressen) neu zusammensetzen. */
async function refreshFakes() {
  for (const f of state.findings) {
    if (f.cat === 'block') await pseudo.prepareBlock(f);
    else if (pseudo.kindOf(f) === 'name') f.fake = pseudo.nameReplace(f.value);
  }
}

function switchOwner(f) {
  f.owner = ownerOfFinding(f) === 'sender' ? 'person' : 'sender';
  f.action = defaultAction(f);
  changed();
  toast(f.owner === 'sender' ? 'Als Absenderdaten markiert.' : 'Als deine Daten markiert.');
}

function removeFinding(f) {
  state.findings = state.findings.filter((x) => x !== f);
  changed();
}

function renderOverlays() {
  const shapes = [];
  if (state.view === 'original') {
    for (const f of state.findings) {
      for (const o of f.occurrences) {
        // Vorschau des Ersatzwerts als kleines Schild über der Stelle
        // nur für den gerade angetippten Fund – sonst würden Schilder den Originaltext verdecken
        const fake = f.id === state.focusId && f.action === 'replace' && o.text ? pseudo.fakeFor(f, o.text) : null;
        o.quads.forEach((quad, i) => shapes.push({
          page: o.page, quad, cls: `hit ${f.action}`, id: f.id,
          tag: i === 0 && fake && fake !== o.text ? fake : null,
        }));
      }
    }
  }
  viewer.setOverlays(shapes);
}

function findingByShape(id) {
  return state.findings.find((f) => f.id === id);
}

function focusFinding(f) {
  if (state.filter !== 'alle' && state.filter !== ownerOfFinding(f)) { state.filter = 'alle'; renderList(); }
  openSheet(true);
  const li = ui.list.querySelector(`[data-id="${f.id}"]`);
  if (!li) return;
  li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  li.classList.add('focus');
  setTimeout(() => li.classList.remove('focus'), 1800);
}

let revealIndex = new Map();
function showInDocument(f) {
  // Mehrfaches Tippen springt reihum durch alle Vorkommen
  const i = ((revealIndex.get(f.id) ?? -1) + 1) % f.occurrences.length;
  revealIndex.set(f.id, i);
  const o = f.occurrences[i];
  state.focusId = f.id;
  renderOverlays();
  if (state.view !== 'original') setView('original');
  openSheet(false);
  viewer.reveal(o.page, o.quads[0], f.id);
  if (f.occurrences.length > 1) toast(`Vorkommen ${i + 1} von ${f.occurrences.length} – erneut tippen für das nächste.`, 2200);
}

function renderToolbar({ index, count, zoom, q }) {
  ui.pageInfo.textContent = count ? `Seite ${index + 1}/${count}` : '';
  ui.zoom.setAttribute('aria-pressed', String(zoom));
  ui.zoom.querySelectorAll('.qmap i').forEach((c, i) => c.classList.toggle('on', i === q));
}

// ---------------------------------------------------------------------------
// Blatt (Liste) auf-/zuklappen
// ---------------------------------------------------------------------------

function openSheet(open) {
  if (isDesktop()) return;
  ui.sheet.classList.toggle('open', open);
  ui.scrim.hidden = !open;
  ui.sheetHead.setAttribute('aria-expanded', String(open));
  if (open) ui.body.scrollTop = ui.body.scrollTop; // iOS: Scrollposition behalten
}

// ---------------------------------------------------------------------------
// Anwenden
// ---------------------------------------------------------------------------

async function primaryAction() {
  if (state.result && !state.stale) return openSave();
  await applyAll();
}

async function applyAll() {
  const active = state.findings.filter((f) => f.action !== 'keep');
  if (!active.length) return toast('Es ist nichts zum Schwärzen oder Ersetzen ausgewählt.');
  state.busy = true;
  renderSummary();
  try {
    const redactions = new Map();
    const get = (p) => {
      if (!redactions.has(p)) redactions.set(p, { quads: [], replacements: [], excluded: new Set(), blockQuads: [] });
      return redactions.get(p);
    };
    for (const f of active) {
      for (const o of f.occurrences) {
        const r = get(o.page);
        const area = f.cat === 'manual' || f.cat === 'image';
        if (area) { r.blockQuads.push(...o.quads); continue; }
        const fake = f.action === 'replace' ? pseudo.fakeFor(f, o.text) : null;
        if (fake !== null && fake === o.text) continue; // z. B. „Herrn“ im Adressblock bleibt stehen
        for (let i = o.start; i < o.end; i++) r.excluded.add(i);
        const replaceable = f.action === 'replace' && o.segments.some((s) => s.geom);
        if (replaceable) r.replacements.push(...splitAcrossLines(o, fake));
        else r.quads.push(...o.quads);
      }
    }
    const { bytes, stats } = await redactPdf({
      bytes: state.file.bytes, pdfDoc: state.doc, redactions, models: state.models,
      rasterAll: settings.rasterAll, dpi: settings.dpi,
      onProgress: (i, n) => busy(`Bearbeite Seite ${i} von ${n} …`),
    });

    busy('Prüfe das Ergebnis …');
    // Geprüft werden die eigentlichen Werte (bei Blöcken die erkannten Teile, z. B. Straße und Name)
    const removedTexts = active.flatMap((f) => f.occurrences.flatMap((o) => (o.parts?.length ? o.parts.map((p) => p.text) : [o.text]))).filter(Boolean);
    const keptTexts = state.findings.filter((f) => f.action === 'keep').flatMap((f) => f.occurrences.map((o) => o.text))
      .concat(active.filter((f) => f.action === 'replace').flatMap((f) => (f.fake || '').split('\n')));
    const replacements = active.filter((f) => f.action === 'replace' && f.fake).map((f) => [f.value, f.fake]);
    const report = await verifyResult({ pdfjsLib, bytes, rules: [], removedTexts, keptTexts });

    await pseudo.commit(active);
    navigator.storage?.persist?.().catch(() => {});

    await clearResult();
    const doc = await pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() }).promise;
    state.result = { bytes, doc, report, stats, replacements };
    state.stale = false;
    ui.tabResult.disabled = false;
    ui.tabResult.classList.remove('stale');
    renderReport();
    await setView('result');
    openSheet(false);
    toast(report.ok ? 'Fertig. Mit „Vorher/Nachher“ vergleichen, dann speichern.' : 'Achtung: Bitte den Prüfbericht ansehen.', 4000);
  } catch (e) {
    reportError(e, 'Bearbeitung fehlgeschlagen.');
  } finally {
    state.busy = false;
    renderSummary();
  }
}

/**
 * Wert über mehrere Zeilen (z. B. umgebrochene IBAN): Ersatz zeilenweise aufteilen – gleiche Zeichenzahl je Zeile
 * wie im Original. Passt die Struktur nicht (z. B. „[anonymisiert]“), steht der Ersatz komplett in der ersten Zeile.
 */
function splitAcrossLines(o, fake) {
  const rows = [];
  for (const seg of o.segments) {
    const y = seg.geom?.baseline[1];
    const row = rows.find((r) => y !== undefined && Math.abs(r.y - y) < (seg.geom.size || 10) * 0.5);
    if (row) row.segments.push(seg); else rows.push({ y, segments: [seg] });
  }
  const origLines = o.text.split('\n').map((t) => t.trim()).filter(Boolean);
  const alnum = (t) => (t.match(/[\p{L}\p{N}]/gu) || []).length;
  if (rows.length < 2 || rows.length !== origLines.length || alnum(fake) !== alnum(o.text.replace(/\n/g, ' '))) {
    return [{ segments: o.segments, text: fake }];
  }
  const parts = [];
  let i = 0;
  const flat = fake.replace(/\s+/g, ' ');
  for (const line of origLines) {
    let need = alnum(line), part = '';
    while (i < flat.length && (need > 0 || !/[\p{L}\p{N}]/u.test(flat[i]))) {
      if (need === 0) break;
      if (/[\p{L}\p{N}]/u.test(flat[i])) need--;
      part += flat[i++];
    }
    parts.push(part.trim());
  }
  parts[parts.length - 1] += flat.slice(i);
  return rows.map((r, k) => ({ segments: r.segments, text: parts[k] }));
}

function renderReport() {
  const { report, stats } = state.result;
  ui.verify.hidden = false;
  ui.verify.replaceChildren();
  const line = (cls, text) => ui.verify.append(el('div', { class: cls }, text));
  const parts = [stats.boxes ? `${stats.boxes} Stelle(n) geschwärzt` : '', stats.replaced ? `${stats.replaced} ersetzt` : ''].filter(Boolean).join(', ');
  if (report.ok) line('ok', `✓ ${parts}. Die Originale sind im neuen PDF nicht mehr auffindbar – weder im Text noch in Datenströmen oder Metadaten.`);
  else line('bad', '✗ Achtung: Im Ergebnis wurden noch Spuren gefunden!');
  if (report.leftInText.length) line('bad', `Noch im Text: ${report.leftInText.join(', ')}`);
  if (report.leftInRaw.length) line('bad', `Noch in PDF-Datenströmen: ${report.leftInRaw.join(', ')}`);
  line('small', `${stats.rasterized} Seite(n) neu aufgebaut, ${stats.copied} übernommen. Metadaten, Kommentare, Formulare, Lesezeichen und Anhänge wurden entfernt.`);
  // Was wurde womit ersetzt?
  const replaced = state.result.replacements || [];
  if (replaced.length) {
    ui.verify.append(el('details', { class: 'report-map', open: replaced.length <= 6 },
      el('summary', {}, `Ersetzt (${replaced.length})`),
      el('table', {}, el('tbody', {}, replaced.map(([from, to]) => el('tr', {}, el('td', {}, from), el('td', { class: 'to' }, `→ ${to}`))))),
    ));
  }
  const existing = state.templateId && templates.get(state.templateId);
  ui.verify.append(el('div', { class: 'actions-row' },
    el('button', { type: 'button', class: 'btn small', onclick: saveTemplate },
      existing ? `Schablone „${existing.name}“ aktualisieren` : '📋 Als Schablone merken'),
  ));
}

async function clearResult() {
  await state.result?.doc?.destroy();
  state.result = null;
  state.stale = false;
  ui.verify.hidden = true;
  ui.tabResult.disabled = true;
  ui.tabResult.classList.remove('stale');
}

async function setView(view) {
  if (view === 'result' && !state.result) return;
  state.view = view;
  ui.tabOriginal.classList.toggle('active', view === 'original');
  ui.tabResult.classList.toggle('active', view === 'result');
  if (view === 'result') { setMarkMode(false); ui.mark.disabled = true; } else ui.mark.disabled = false;
  renderOverlays();
  // Gleiche Seite und gleiches Viertel im anderen Dokument zeigen – ideal zum Vergleichen
  await viewer.setDocument(view === 'result' ? state.result.doc : state.doc, { keepPosition: true });
}

function setMarkMode(on) {
  viewer.setMarkMode(on);
  ui.mark.setAttribute('aria-pressed', String(on));
  if (on) { openSheet(false); toast('Rahmen um den Bereich ziehen, der geschwärzt werden soll. Wischen ist jetzt aus.', 4000); }
}

// ---------------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------------

function ensurePdfName(name) {
  name = (name || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || state.file.name;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function openSave() {
  if (!ui.saveName.value) ui.saveName.value = state.file.name;
  const ios = matchMedia('(pointer: coarse)').matches;
  ui.saveHint.textContent = state.file.handle
    ? 'Bei gleichem Namen wird die geöffnete Datei überschrieben.'
    : ios ? 'Im nächsten Schritt „In Dateien sichern“ wählen. Für denselben Namen den Ordner des Originals wählen und „Ersetzen“ bestätigen.'
      : 'Die Datei wird heruntergeladen.';
  ui.saveDlg.showModal();
}

async function save() {
  const name = ensurePdfName(ui.saveName.value);
  ui.saveName.value = name;
  const blob = new Blob([state.result.bytes], { type: 'application/pdf' });
  try {
    if (state.file.handle && name === state.file.name) {
      const w = await state.file.handle.createWritable();
      await w.write(blob);
      await w.close();
      return toast(`Gespeichert: ${name}`);
    }
    const file = new File([blob], name, { type: 'application/pdf' });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    if (window.showSaveFilePicker) {
      const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return toast(`Gespeichert: ${h.name}`);
    }
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast(`Gespeichert: ${name}`);
  } catch (e) {
    if (e.name !== 'AbortError') reportError(e, 'Speichern fehlgeschlagen.');
  }
}

// ---------------------------------------------------------------------------
// Einstellungen und Pseudonym-Tabelle
// ---------------------------------------------------------------------------

function renderTable() {
  const rows = table.list();
  if (!rows.length) {
    ui.tableBox.replaceChildren(el('div', { class: 'none' }, 'Noch leer. Wenn du Funde „ersetzt“, landen die Ersatzwerte hier.'));
    return;
  }
  ui.tableBox.replaceChildren(el('table', {}, el('tbody', {}, rows.map((r) => el('tr', {},
    el('td', { class: 'k' }, `${r.label || r.kind}`, el('br'), r.hint),
    el('td', { class: 'f' }, r.fake),
    el('td', { class: 'x' }, el('button', { type: 'button', 'aria-label': 'Eintrag löschen', onclick: () => { table.remove(r.hash); renderTable(); } }, '✕')),
  )))));
}

function renderTemplates() {
  const rows = templates.list();
  if (!rows.length) {
    ui.templateBox.replaceChildren(el('div', { class: 'none' }, 'Noch keine. Nach „Anwenden“ kannst du die Bearbeitung als Schablone merken.'));
    return;
  }
  ui.templateBox.replaceChildren(el('table', {}, el('tbody', {}, rows.map((t) => el('tr', {},
    el('td', {}, el('b', {}, t.name), el('br'),
      el('span', { class: 'small' }, `${Object.keys(t.rules).length + t.areas.length + t.hints.length} Schritte · ${t.uses}× benutzt`)),
    el('td', { class: 'x' }, el('button', { type: 'button', 'aria-label': 'Schablone löschen', onclick: () => { templates.remove(t.id); renderTemplates(); } }, '✕')),
  )))));
}

function openSettings() {
  ui.setDefault.value = settings.defaultAction;
  ui.setLow.checked = settings.preselectLow;
  ui.setSender.checked = settings.preselectSender;
  ui.setDpi.value = String(settings.dpi);
  ui.setRasterAll.checked = settings.rasterAll;
  renderTable();
  renderTemplates();
  ui.settings.showModal();
}

ui.settings.addEventListener('close', () => {
  const rasterChanged = settings.rasterAll !== ui.setRasterAll.checked || settings.dpi !== Number(ui.setDpi.value);
  settings.defaultAction = ui.setDefault.value;
  settings.preselectLow = ui.setLow.checked;
  settings.preselectSender = ui.setSender.checked;
  settings.dpi = Number(ui.setDpi.value);
  settings.rasterAll = ui.setRasterAll.checked;
  storeSettings();
  if (rasterChanged && state.result) changed();
});

ui.btnExport.addEventListener('click', () => {
  const backup = { ...JSON.parse(table.export()), templates: templates.items };
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
  const name = `pdf-datenschutz-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
});
ui.btnImport.addEventListener('click', () => { ui.importInput.value = ''; ui.importInput.click(); });
ui.importInput.addEventListener('change', async () => {
  try {
    const json = await ui.importInput.files[0].text();
    table.import(json);
    templates.import(JSON.parse(json).templates);
    renderTable();
    renderTemplates();
    toast('Sicherung wiederhergestellt.');
  } catch (e) { reportError(e, 'Wiederherstellen fehlgeschlagen.'); }
});
ui.btnClearTable.addEventListener('click', () => {
  if (!confirm('Alle gemerkten Ersatzwerte löschen?')) return;
  table.clear();
  renderTable();
});

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------

ui.open.addEventListener('click', pickFile);
ui.open2.addEventListener('click', pickFile);
ui.fileInput.addEventListener('change', () => {
  const f = ui.fileInput.files[0];
  ui.fileInput.value = ''; // dieselbe Datei später erneut öffnen können
  if (f) openFile(f);
});
ui.btnSettings.addEventListener('click', openSettings);
ui.zoom.addEventListener('click', () => viewer.toggleZoom(0));
ui.mark.addEventListener('click', () => setMarkMode(!viewer.markMode));
ui.tabOriginal.addEventListener('click', () => setView('original'));
ui.tabResult.addEventListener('click', () => setView('result'));
ui.sheetHead.addEventListener('click', () => openSheet(!ui.sheet.classList.contains('open')));
ui.scrim.addEventListener('click', () => openSheet(false));
ui.primary.addEventListener('click', primaryAction);
ui.hintForm.addEventListener('submit', (e) => { e.preventDefault(); ui.hintInput.blur(); applyHint(ui.hintInput.value); });
ui.bulk.addEventListener('click', (e) => {
  const a = e.target.dataset?.bulk;
  if (!a) return;
  for (const f of state.findings) {
    if (state.filter !== 'alle' && ownerOfFinding(f) !== state.filter) continue;
    if (a === 'replace' && !f.fake) continue;
    if (f.cat === 'manual' && a === 'keep') continue;
    f.action = a;
  }
  changed();
});
ui.saveDlg.addEventListener('close', () => { if (ui.saveDlg.returnValue === 'save') save(); });

// Pfeiltasten am Computer
document.addEventListener('keydown', (e) => {
  if (!state.doc || e.target.closest('input, textarea, select, dialog')) return;
  const map = { ArrowRight: 'next', ArrowLeft: 'prev', ArrowDown: 'down', ArrowUp: 'up' };
  if (map[e.key]) { e.preventDefault(); viewer[map[e.key]](); }
  if (e.key === 'z') viewer.toggleZoom(0);
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

// Altes Sprachmodell der ersten Version (ca. 80 MB) vom Gerät entfernen
globalThis.caches?.delete('transformers-cache').catch(() => {});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Für automatisierte Tests
window.__pdfPrivacy = { state, viewer, table, templates, openFile, applyAll, applyHint, setAction, applyTemplate, saveTemplate };
