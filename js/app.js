// Ablauf der App: PDF öffnen → automatisch prüfen → pro Fund entscheiden → anwenden → vergleichen → speichern.

import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { scanDocument, parseCommand, findMatches, valueKey, normalize, SHORT } from './detect.js';
import { buildPageModel, segmentsForRange, findImages } from './pdfmodel.js';
import { redactPdf, verifyResult } from './redact.js';
import { PageViewer } from './viewer.js';
import { PseudonymTable, Pseudonymizer } from './pseudo.js';

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
  settings: $('settings'), btnSettings: $('btnSettings'), setDefault: $('setDefault'), setLow: $('setLow'),
  setDpi: $('setDpi'), setRasterAll: $('setRasterAll'), tableBox: $('tableBox'),
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
};

const SETTINGS_KEY = 'pdfprivacy.settings';
const settings = (() => {
  const def = { defaultAction: 'redact', preselectLow: false, dpi: 200, rasterAll: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return def; }
})();
function storeSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* privater Modus */ }
}

const table = new PseudonymTable();
let pseudo = new Pseudonymizer(table);

const viewer = new PageViewer(ui.viewer, {
  onChange: renderToolbar,
  onTapShape: (id) => { const f = findingByShape(id); if (f) focusFinding(f); },
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
    Object.assign(state, { file: { name: file.name || 'dokument.pdf', bytes, handle }, doc, models: [], findings: [], notices: [], filter: 'alle' });
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
  const found = scanDocument(texts()).map((g) => makeFinding(g));

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
  }
  state.findings = found;
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

async function addManualArea(page, quad) {
  const n = state.findings.filter((f) => f.cat === 'manual').length + 1;
  const f = makeFinding({
    cat: 'manual', label: 'Markierter Bereich', risk: 'hoch', value: `Bereich ${n} auf Seite ${page + 1}`,
    occurrences: [{ page, segments: [{ quad }], text: '' }],
  });
  f.action = 'redact';
  state.findings.unshift(f);
  changed();
  toast('Bereich wird geschwärzt. Weitere Bereiche ziehen oder ▭ beenden.');
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
    if (keepMatch) {
      for (const f of state.findings) {
        const hit = rule.kind === 'category' ? f.cat === rule.cat
          : normalize(f.value).includes(normalize(rule.term)) || hits.some((h) => f.occurrences.some((o) => o.page === h.page && o.start < h.end && h.start < o.end));
        if (hit && f.action !== 'keep') { f.action = 'keep'; changedCount++; }
      }
      continue;
    }
    const fresh = [];
    for (const h of hits) {
      const owner = state.findings.find((f) => f.occurrences.some((o) => o.page === h.page && o.start < h.end && h.start < o.end));
      if (owner) {
        if (owner.action === 'keep') { owner.action = owner.fake && settings.defaultAction === 'replace' ? 'replace' : 'redact'; changedCount++; }
      } else fresh.push(h);
    }
    // Neue Treffer nach Wert zusammenfassen
    const groups = new Map();
    for (const h of fresh) {
      const cat = rule.kind === 'category' ? rule.cat : 'hint';
      const key = valueKey(cat, h.text);
      if (!groups.has(key)) groups.set(key, { cat, label: rule.kind === 'category' ? SHORT[cat] : 'Dein Hinweis', risk: 'hoch', occurrences: [] });
      groups.get(key).occurrences.push({ page: h.page, start: h.start, end: h.end, text: h.text });
    }
    for (const g of groups.values()) {
      const vals = [...new Set(g.occurrences.map((o) => o.text.replace(/\s+/g, ' ').trim()))];
      g.value = vals.reduce((a, b) => (b.length > a.length ? b : a));
      g.variants = vals.filter((v) => v !== g.value);
      const f = makeFinding(g);
      await pseudo.prepare(f);
      f.action = f.known ? 'replace' : settings.defaultAction === 'replace' && f.fake ? 'replace' : 'redact';
      state.findings.unshift(f);
      added++;
    }
  }
  ui.hintInput.value = '';
  state.filter = 'alle';
  changed();
  if (added || changedCount) toast(keepMatch ? `${changedCount} Fund(e) bleiben unverändert.` : `${added} neue Fund(e)${changedCount ? `, ${changedCount} geändert` : ''}.`);
  else toast('Dazu wurde im Dokument nichts gefunden.');
  if (added) ui.list.firstElementChild?.scrollIntoView({ block: 'nearest' });
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

const RISK_ORDER = ['hoch', 'mittel', 'niedrig'];

function renderList() {
  // Filter
  const by = (r) => state.findings.filter((f) => f.risk === r).length;
  ui.filters.replaceChildren(
    ...[['alle', `Alle ${state.findings.length}`], ...RISK_ORDER.map((r) => [r, `${r[0].toUpperCase() + r.slice(1)} ${by(r)}`])]
      .filter(([k]) => k === 'alle' || by(k))
      .map(([k, label]) => el('button', {
        type: 'button', class: state.filter === k ? 'on' : '',
        onclick: () => { state.filter = k; renderList(); },
      }, k !== 'alle' ? el('span', { class: 'dot', style: `background: var(--${k === 'hoch' ? 'high' : k === 'mittel' ? 'mid' : 'low'})` }) : null, label)),
  );
  ui.bulk.hidden = state.findings.length < 2;

  const visible = state.findings.filter((f) => state.filter === 'alle' || f.risk === state.filter);
  ui.list.replaceChildren(
    ...state.notices.map((t) => el('li', { class: 'notice' }, '⚠︎ ', t)),
    ...visible.map(renderFinding),
  );
  if (!state.findings.length && state.doc) {
    ui.list.append(el('li', { class: 'nothing' }, 'Keine kritischen Daten erkannt. Ergänze per Hinweis oder markiere Bereiche mit ▭.'));
  }
}

function renderFinding(f) {
  const where = [...new Set(f.occurrences.map((o) => o.page + 1))];
  const times = f.occurrences.length;
  const canReplace = !!f.fake;
  const actions = [['redact', 'Schwärzen'], ...(canReplace ? [['replace', 'Ersetzen']] : []), ['keep', f.cat === 'manual' ? 'Entfernen' : 'Behalten']];
  return el('li', { class: `finding r-${f.risk}`, dataset: { id: f.id } },
    el('div', { class: 'meta' },
      el('span', { class: 'risk' }, f.risk),
      el('span', {}, f.label),
      el('span', { class: 'where' }, `S. ${where.join(', ')}${times > 1 ? ` · ${times}×` : ''}`),
    ),
    el('button', {
      type: 'button', class: `value${/\d/.test(f.value) && f.occurrences[0].text ? '' : ' text'}`, title: 'Im Dokument zeigen',
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
    f.action === 'replace' ? el('div', { class: 'fake' },
      el('span', { class: 'arrow' }, '→'),
      el('code', {}, f.fake),
      f.known ? el('span', { class: 'known', title: 'Aus deiner Pseudonym-Tabelle' }, 'bekannt') : null,
      el('button', { type: 'button', class: 'dice', 'aria-label': 'Anderen Ersatzwert erzeugen', onclick: () => { pseudo.regenerate(f); refreshNameFakes(); changed(); } }, '🎲'),
    ) : null,
  );
}

/** Nach dem Neu-Würfeln eines Namens die anderen Namen (gleiche Bestandteile) aktualisieren. */
function refreshNameFakes() {
  for (const f of state.findings) if (pseudo.kindOf(f) === 'name') f.fake = pseudo.nameReplace(f.value);
}

function removeFinding(f) {
  state.findings = state.findings.filter((x) => x !== f);
  changed();
}

function renderOverlays() {
  const shapes = [];
  if (state.view === 'original') {
    for (const f of state.findings) {
      for (const o of f.occurrences) for (const quad of o.quads) shapes.push({ page: o.page, quad, cls: `hit ${f.action}`, id: f.id });
    }
  }
  viewer.setOverlays(shapes);
}

function findingByShape(id) {
  return state.findings.find((f) => f.id === id);
}

function focusFinding(f) {
  if (state.filter !== 'alle' && state.filter !== f.risk) { state.filter = 'alle'; renderList(); }
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
        for (let i = o.start; i < o.end; i++) r.excluded.add(i);
        const replaceable = f.action === 'replace' && o.segments.some((s) => s.geom);
        if (replaceable) r.replacements.push({ segments: o.segments, text: pseudo.fakeFor(f, o.text) });
        else r.quads.push(...o.quads);
      }
    }
    const { bytes, stats } = await redactPdf({
      bytes: state.file.bytes, pdfDoc: state.doc, redactions, models: state.models,
      rasterAll: settings.rasterAll, dpi: settings.dpi,
      onProgress: (i, n) => busy(`Bearbeite Seite ${i} von ${n} …`),
    });

    busy('Prüfe das Ergebnis …');
    const removedTexts = active.flatMap((f) => f.occurrences.map((o) => o.text)).filter(Boolean);
    const keptTexts = state.findings.filter((f) => f.action === 'keep').flatMap((f) => f.occurrences.map((o) => o.text))
      .concat(active.filter((f) => f.action === 'replace').map((f) => f.fake || ''));
    const report = await verifyResult({ pdfjsLib, bytes, rules: [], removedTexts, keptTexts });

    await pseudo.commit(active);
    navigator.storage?.persist?.().catch(() => {});

    await clearResult();
    const doc = await pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() }).promise;
    state.result = { bytes, doc, report, stats };
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

function openSettings() {
  ui.setDefault.value = settings.defaultAction;
  ui.setLow.checked = settings.preselectLow;
  ui.setDpi.value = String(settings.dpi);
  ui.setRasterAll.checked = settings.rasterAll;
  renderTable();
  ui.settings.showModal();
}

ui.settings.addEventListener('close', () => {
  const rasterChanged = settings.rasterAll !== ui.setRasterAll.checked || settings.dpi !== Number(ui.setDpi.value);
  settings.defaultAction = ui.setDefault.value;
  settings.preselectLow = ui.setLow.checked;
  settings.dpi = Number(ui.setDpi.value);
  settings.rasterAll = ui.setRasterAll.checked;
  storeSettings();
  if (rasterChanged && state.result) changed();
});

ui.btnExport.addEventListener('click', () => {
  const blob = new Blob([table.export()], { type: 'application/json' });
  const name = `pseudonym-tabelle-${new Date().toISOString().slice(0, 10)}.json`;
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
    table.import(await ui.importInput.files[0].text());
    renderTable();
    toast('Tabelle wiederhergestellt.');
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
    if (state.filter !== 'alle' && f.risk !== state.filter) continue;
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
window.__pdfPrivacy = { state, viewer, table, openFile, applyAll, applyHint, setAction };
