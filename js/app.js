// Steuerung der App: Dokument laden, Befehle ausführen, Treffer verwalten, Schwärzen, Speichern.

import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { parseCommand, findMatches, ruleLabel } from './detect.js';
import { buildPageModel, quadsForRange } from './pdfmodel.js';
import { redactPdf, verifyResult } from './redact.js';
import { Viewer } from './viewer.js';
import { LocalSpeech } from './speech.js';

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
  viewBar: $('viewBar'), tabOriginal: $('tabOriginal'), tabResult: $('tabResult'), mark: $('btnMark'),
  empty: $('empty'), viewOriginal: $('viewOriginal'), viewResult: $('viewResult'),
  sheet: $('sheet'), status: $('status'), mic: $('btnMic'), form: $('cmdForm'), input: $('cmdInput'),
  rules: $('rules'), undo: $('btnUndo'), apply: $('btnApply'),
  saveBar: $('saveBar'), verify: $('verify'), saveName: $('saveName'), save: $('btnSave'),
  settings: $('settings'), btnSettings: $('btnSettings'), setModel: $('setModel'), setDpi: $('setDpi'),
  setRasterAll: $('setRasterAll'), clearModel: $('btnClearModel'), toast: $('toast'),
};

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const state = {
  file: null, // { name, bytes, handle }
  doc: null, // pdf.js-Dokument (Original)
  models: [], // Textmodelle je Seite
  rules: [], // Regeln mit Treffern
  manual: null, // Regel für manuell markierte Bereiche
  history: [], // für „Rückgängig“: Regel-IDs bzw. {manual: id}
  result: null, // { bytes, doc, report }
  stale: false,
  view: 'original',
  busy: false,
};

const settings = loadSettings();
function loadSettings() {
  const def = { model: 'Xenova/whisper-base', dpi: 200, rasterAll: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem('pdfredact.settings') || '{}') }; } catch { return def; }
}
function storeSettings() {
  try { localStorage.setItem('pdfredact.settings', JSON.stringify(settings)); } catch { /* privater Modus */ }
}

const viewerOriginal = new Viewer(ui.viewOriginal, { onDraw: addManualBox });
const viewerResult = new Viewer(ui.viewResult);

// ---------------------------------------------------------------------------
// Statusanzeige
// ---------------------------------------------------------------------------

function setStatus(text, kind = '') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

let toastTimer;
function toast(text, ms = 3200) {
  ui.toast.textContent = text;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidden = true), ms);
}

// ---------------------------------------------------------------------------
// Dokument öffnen
// ---------------------------------------------------------------------------

async function pickFile() {
  if (window.showOpenFilePicker) {
    // Desktop-Chrome/Edge: Dateizugriff behalten, damit „Speichern“ die Datei direkt überschreiben kann
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
    setStatus('Dokument wird geöffnet …', 'busy');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const task = pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() });
    task.onPassword = (cb, reason) => {
      const pw = prompt(reason === 2 ? 'Falsches Passwort. Bitte erneut eingeben:' : 'Dieses PDF ist passwortgeschützt. Passwort:');
      if (pw === null) task.destroy(); else cb(pw);
    };
    const doc = await task.promise;

    await resetAll(false);
    state.doc?.destroy();
    state.file = { name: file.name || 'dokument.pdf', bytes, handle };
    state.doc = doc;
    ui.fileName.textContent = state.file.name;
    ui.saveName.value = state.file.name;
    ui.empty.hidden = true;
    ui.viewBar.hidden = false;
    ui.sheet.hidden = false;
    showView('original');
    await viewerOriginal.setDocument(doc);

    state.models = [];
    for (let i = 1; i <= doc.numPages; i++) {
      setStatus(`Text wird gelesen … Seite ${i}/${doc.numPages}`, 'busy');
      state.models.push(await buildPageModel(await doc.getPage(i)));
    }
    const chars = state.models.reduce((n, m) => n + m.text.trim().length, 0);
    if (!chars) {
      setStatus('Keine Textebene gefunden (eingescanntes Dokument?). Markiere die Bereiche von Hand mit „Bereich markieren“.', 'error');
    } else {
      setStatus(`${doc.numPages} Seite${doc.numPages > 1 ? 'n' : ''} geladen. Tippe aufs Mikrofon und sag, was entfernt werden soll.`);
    }
    updateButtons();
  } catch (e) {
    reportError(e, 'Das PDF konnte nicht geöffnet werden.');
  }
}

// ---------------------------------------------------------------------------
// Regeln und Treffer
// ---------------------------------------------------------------------------

let matchSeq = 0;
function computeMatches(rule) {
  const texts = state.models.map((m) => m.text);
  rule.matches = findMatches(rule, texts).map((m) => ({
    ...m,
    id: `m${++matchSeq}`,
    selected: true,
    quads: quadsForRange(state.models[m.page], m.start, m.end),
  }));
}

function addRules(rules, source) {
  const summary = [];
  for (const rule of rules) {
    rule.source = source;
    computeMatches(rule);
    state.rules.push(rule);
    state.history.push(rule.id);
    summary.push(`${ruleLabel(rule)}: ${rule.matches.length || 'keine'} Treffer`);
  }
  changed();
  setStatus(summary.join(' · '));
  const first = rules.flatMap((r) => r.matches)[0];
  if (first) viewerOriginal.scrollToShape(first.page, first.quads[0]);
}

function addManualBox(page, quad) {
  if (!state.manual) {
    state.manual = { id: 'manual', kind: 'manual', matches: [] };
  }
  const m = { id: `m${++matchSeq}`, page, quads: [quad], text: '', selected: true, manual: true };
  state.manual.matches.push(m);
  state.history.push({ manual: m.id });
  changed();
  setStatus(`Bereich auf Seite ${page + 1} markiert.`);
}

function allRules() {
  return state.manual?.matches.length ? [...state.rules, state.manual] : state.rules;
}

function selectedMatches() {
  return allRules().flatMap((r) => r.matches.filter((m) => m.selected));
}

function undo() {
  const last = state.history.pop();
  if (!last) return toast('Nichts zum Rückgängigmachen.');
  if (last.manual) {
    state.manual.matches = state.manual.matches.filter((m) => m.id !== last.manual);
    setStatus('Letzte Markierung entfernt.');
  } else {
    const rule = state.rules.find((r) => r.id === last);
    state.rules = state.rules.filter((r) => r.id !== last);
    setStatus(`Rückgängig: ${rule ? ruleLabel(rule) : 'Regel'}`);
  }
  changed();
}

function removeRule(id) {
  if (id === 'manual') { state.manual = null; state.history = state.history.filter((h) => !h.manual); }
  else { state.rules = state.rules.filter((r) => r.id !== id); state.history = state.history.filter((h) => h !== id); }
  changed();
}

async function resetAll(announce = true) {
  state.rules = [];
  state.manual = null;
  state.history = [];
  await clearResult();
  if (state.doc) changed();
  if (announce) setStatus('Alle Regeln und Markierungen verworfen.');
}

async function clearResult() {
  viewerResult.clear();
  await state.result?.doc?.destroy();
  state.result = null;
  state.stale = false;
  ui.saveBar.hidden = true;
  ui.tabResult.disabled = true;
  ui.tabResult.classList.remove('stale');
  if (state.view === 'result') showView('original');
}

/** Nach jeder Änderung: Liste, Markierungen und Knöpfe aktualisieren. */
function changed() {
  if (state.result) {
    state.stale = true;
    ui.tabResult.classList.add('stale');
    ui.verify.innerHTML = '<span class="warn">Die Auswahl hat sich geändert – bitte erneut „Schwärzen“.</span>';
  }
  renderRules();
  renderOverlays();
  updateButtons();
}

function updateButtons() {
  ui.undo.disabled = !state.history.length;
  ui.apply.disabled = !state.doc || state.busy || !selectedMatches().length;
  ui.save.disabled = !state.result || state.stale || state.busy;
}

function renderOverlays() {
  const shapes = [];
  for (const r of allRules()) {
    for (const m of r.matches) {
      const cls = m.manual ? 'manual' : `hit${m.fuzzy ? ' fuzzy' : ''}${m.selected ? '' : ' off'}`;
      for (const q of m.quads) shapes.push({ page: m.page, quad: q, cls, id: m.id });
    }
  }
  viewerOriginal.setOverlays(shapes);
}

function findMatch(id) {
  for (const r of allRules()) for (const m of r.matches) if (m.id === id) return m;
  return null;
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c !== null && c !== undefined));
  return e;
}

const openRules = new Set(); // aufgeklappte Regeln merken

function renderRules() {
  ui.rules.replaceChildren();
  for (const r of allRules()) {
    const sel = r.matches.filter((m) => m.selected).length;
    const all = el('input', {
      type: 'checkbox', checked: sel > 0 && sel === r.matches.length, disabled: !r.matches.length,
      'aria-label': 'Alle an/aus',
      onchange: (e) => { r.matches.forEach((m) => (m.selected = e.target.checked)); changed(); },
    });
    all.indeterminate = sel > 0 && sel < r.matches.length;
    all.addEventListener('click', (e) => e.stopPropagation());
    const head = el('summary', { class: 'rule-head' },
      all,
      el('span', { class: 'title' }, r.kind === 'manual' ? 'Manuell markierte Bereiche' : ruleLabel(r)),
      el('span', { class: `count${r.matches.length ? '' : ' none'}` }, r.matches.length ? `${sel}/${r.matches.length}` : 'keine Treffer'),
      el('button', { type: 'button', 'aria-label': 'Regel entfernen', onclick: (e) => { e.preventDefault(); removeRule(r.id); } }, '✕'),
    );
    const box = el('details', { class: 'rule', open: openRules.has(r.id) || !r.matches.length }, head);
    box.addEventListener('toggle', () => (box.open ? openRules.add(r.id) : openRules.delete(r.id)));
    if (!r.matches.length) {
      box.append(el('div', { class: 'empty-hint' }, r.kind === 'term'
        ? 'Nicht gefunden. Versuch eine andere Schreibweise, tippe den Begriff ein oder markiere die Stelle von Hand.'
        : 'Im Dokument nicht gefunden.'));
    } else {
      const ul = el('ul');
      for (const m of r.matches) {
        ul.append(el('li', {},
          el('label', {},
            el('input', { type: 'checkbox', checked: m.selected, onchange: (e) => { m.selected = e.target.checked; changed(); } }),
            el('span', { class: 't' }, m.manual ? 'Fläche' : m.text.replace(/\s+/g, ' ')),
            m.note ? el('span', { class: 'note' }, m.note) : null,
          ),
          el('span', { class: 'pg' }, `S. ${m.page + 1}`),
          el('button', { type: 'button', onclick: () => { showView('original'); viewerOriginal.scrollToShape(m.page, m.quads[0]); } }, 'zeigen'),
        ));
      }
      box.append(ul);
    }
    ui.rules.append(box);
  }
}

// Tippen auf eine Markierung im Dokument schaltet den Treffer an/aus
ui.viewOriginal.addEventListener('click', (e) => {
  const id = e.target?.dataset?.id;
  if (!id || viewerOriginal.markMode) return;
  const m = findMatch(id);
  if (!m) return;
  if (m.manual) {
    state.manual.matches = state.manual.matches.filter((x) => x !== m);
    toast('Markierung entfernt.');
  } else {
    m.selected = !m.selected;
    toast(m.selected ? `„${m.text}“ wird geschwärzt` : `„${m.text}“ bleibt stehen`);
  }
  changed();
});

// ---------------------------------------------------------------------------
// Befehle
// ---------------------------------------------------------------------------

async function runCommand(text) {
  text = text.trim();
  if (!text) return;
  if (!state.doc) return toast('Bitte zuerst ein PDF öffnen.');
  const cmd = parseCommand(text);
  switch (cmd.action) {
    case 'add': addRules(cmd.rules, text); break;
    case 'apply': await applyRedaction(); break;
    case 'undo': undo(); break;
    case 'reset': await resetAll(); break;
    case 'showResult': state.result ? showView('result') : toast('Noch kein Ergebnis – sag „Schwärzen“.'); break;
    case 'showOriginal': showView('original'); break;
    case 'save':
      if (cmd.saveName) ui.saveName.value = cmd.saveName;
      if (!state.result || state.stale) await applyRedaction();
      if (state.result) await save(false);
      break;
    default: setStatus(`Nicht verstanden: „${text}“`, 'error');
  }
  ui.input.value = '';
}

// ---------------------------------------------------------------------------
// Schwärzen
// ---------------------------------------------------------------------------

async function applyRedaction() {
  const sel = selectedMatches();
  if (!sel.length) return toast('Es ist nichts zum Schwärzen ausgewählt.');
  state.busy = true;
  updateButtons();
  try {
    const redactions = new Map();
    for (const m of sel) {
      if (!redactions.has(m.page)) redactions.set(m.page, { quads: [], excluded: new Set(), blockQuads: [] });
      const r = redactions.get(m.page);
      r.quads.push(...m.quads);
      if (m.manual) r.blockQuads.push(...m.quads);
      else for (let i = m.start; i < m.end; i++) r.excluded.add(i);
    }
    const { bytes, stats } = await redactPdf({
      bytes: state.file.bytes, pdfDoc: state.doc, redactions, models: state.models,
      rasterAll: settings.rasterAll, dpi: settings.dpi,
      onProgress: (i, n) => setStatus(`Schwärze … Seite ${i}/${n}`, 'busy'),
    });

    setStatus('Prüfe das Ergebnis …', 'busy');
    const removedTexts = sel.filter((m) => !m.manual).map((m) => m.text);
    const keptTexts = allRules().flatMap((r) => r.matches.filter((m) => !m.selected && !m.manual).map((m) => m.text));
    const report = await verifyResult({ pdfjsLib, bytes, rules: state.rules, removedTexts, keptTexts });

    await clearResult();
    const doc = await pdfjsLib.getDocument({ ...PDF_OPTS, data: bytes.slice() }).promise;
    state.result = { bytes, doc, report, stats };
    await viewerResult.setDocument(doc);
    ui.tabResult.disabled = false;
    ui.saveBar.hidden = false;
    renderReport(report, stats, sel.length);
    showView('result');
    setStatus(report.ok ? 'Fertig. Vergleiche Original und Ergebnis, dann speichern.' : 'Fertig – bitte Prüfhinweise beachten.', report.ok ? '' : 'error');
  } catch (e) {
    reportError(e, 'Schwärzen fehlgeschlagen.');
  } finally {
    state.busy = false;
    updateButtons();
  }
}

function renderReport(report, stats, count) {
  ui.verify.replaceChildren();
  const line = (cls, text) => ui.verify.append(el('div', { class: cls }, text));
  if (report.ok) line('ok', `✓ ${count} Stelle${count > 1 ? 'n' : ''} entfernt – im Ergebnis-PDF nicht mehr auffindbar (Text, Datenströme, Metadaten).`);
  else line('bad', '✗ Achtung: Im Ergebnis wurden noch Spuren gefunden!');
  if (report.leftInText.length) line('bad', `Noch im Text: ${report.leftInText.join(', ')}`);
  if (report.leftInRaw.length) line('bad', `Noch in PDF-Datenströmen: ${report.leftInRaw.join(', ')}`);
  for (const h of report.ruleHits) line('warn', `Hinweis: ${ruleLabel(h.rule)} – ${h.count} nicht ausgewählte Stelle${h.count > 1 ? 'n' : ''} sind noch enthalten.`);
  line('small', `${stats.rasterized} Seite(n) neu als Bild aufgebaut, ${stats.copied} unverändert übernommen. Metadaten, Kommentare, Formulare, Lesezeichen und Anhänge wurden entfernt.`);
}

// ---------------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------------

function ensurePdfName(name) {
  name = (name || '').trim().replace(/[\\/:*?"<>|]+/g, '-') || state.file.name;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

async function save(fromTap) {
  if (!state.result || state.stale) return toast('Bitte zuerst „Schwärzen“.');
  const name = ensurePdfName(ui.saveName.value);
  ui.saveName.value = name;
  const blob = new Blob([state.result.bytes], { type: 'application/pdf' });
  try {
    // 1) Desktop: Originaldatei direkt überschreiben
    if (state.file.handle && name === state.file.name) {
      const w = await state.file.handle.createWritable();
      await w.write(blob);
      await w.close();
      return toast(`Gespeichert: ${name} (überschrieben)`);
    }
    // 2) iPhone/iPad: Teilen-Menü → „In Dateien sichern“ (lokal, kein Upload)
    const file = new File([blob], name, { type: 'application/pdf' });
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        if (e.name === 'NotAllowedError' && !fromTap) {
          ui.save.focus();
          return toast('Bitte jetzt auf „Speichern“ tippen.', 5000);
        }
      }
    }
    // 3) Desktop ohne Dateizugriff: Speichern-Dialog oder Download
    if (window.showSaveFilePicker && fromTap) {
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
// Ansicht
// ---------------------------------------------------------------------------

function showView(view) {
  const from = view === 'result' ? ui.viewOriginal : ui.viewResult;
  const to = view === 'result' ? ui.viewResult : ui.viewOriginal;
  if (view === 'result' && !state.result) return;
  // Gleiche Stelle im anderen Dokument zeigen (Seiten sind gleich groß)
  const ratio = from.scrollHeight ? from.scrollTop / from.scrollHeight : 0;
  state.view = view;
  ui.viewOriginal.hidden = view !== 'original';
  ui.viewResult.hidden = view !== 'result';
  ui.tabOriginal.classList.toggle('active', view === 'original');
  ui.tabResult.classList.toggle('active', view === 'result');
  ui.mark.hidden = view !== 'original';
  requestAnimationFrame(() => (to.scrollTop = ratio * to.scrollHeight));
}

function setMarkMode(on) {
  viewerOriginal.setMarkMode(on);
  ui.mark.setAttribute('aria-pressed', String(on));
  if (on) setStatus('Ziehe mit dem Finger einen Rahmen um den Bereich, der geschwärzt werden soll. Zum Scrollen den Modus beenden.');
}

// ---------------------------------------------------------------------------
// Sprache
// ---------------------------------------------------------------------------

const speech = new LocalSpeech({
  onProgress: (p) => {
    if (p.status === 'progress' && p.total) {
      setStatus(`Sprachmodell wird geladen (einmalig): ${Math.round((p.loaded / p.total) * 100)} % von ${p.file}`, 'busy');
    }
  },
  onState: (s) => {
    ui.mic.classList.toggle('recording', s === 'recording');
    ui.mic.classList.toggle('working', s === 'transcribing');
    if (s === 'recording') setStatus('Ich höre zu … (tippe erneut zum Beenden)');
    if (s === 'transcribing') setStatus(speech.ready ? 'Erkenne Sprache (lokal) …' : 'Warte auf Sprachmodell …', 'busy');
  },
});
speech.model = settings.model;
speech.onAutoStop = () => finishRecording();

function modelDownloaded() {
  try { return localStorage.getItem(`pdfredact.model.${settings.model}`) === '1'; } catch { return false; }
}

async function toggleMic() {
  if (speech.recording) return finishRecording();
  if (ui.mic.classList.contains('working')) return;
  if (!speech.supported) return toast('Mikrofon wird von diesem Browser nicht unterstützt – bitte tippen.');
  if (!speech.ready && !modelDownloaded()) {
    const size = ui.setModel.selectedOptions[0]?.textContent.split(',').pop().trim() || '';
    if (!confirm(`Für die Spracherkennung wird einmalig ein Sprachmodell (${size}) auf dieses Gerät geladen. Danach funktioniert sie offline. Deine Aufnahmen verlassen das Gerät nie.\n\nJetzt laden?`)) return;
  }
  try {
    await speech.start(); // direkt im Tipp-Ereignis (iOS-Vorgabe)
    speech.load(settings.model).then(() => {
      try { localStorage.setItem(`pdfredact.model.${settings.model}`, '1'); } catch { /* egal */ }
      if (speech.recording) setStatus('Ich höre zu … (tippe erneut zum Beenden)');
    }).catch((e) => reportError(e, 'Sprachmodell konnte nicht geladen werden.'));
  } catch (e) {
    reportError(e, e.name === 'NotAllowedError' ? 'Kein Mikrofonzugriff – bitte in den Einstellungen erlauben.' : 'Aufnahme nicht möglich.');
  }
}

async function finishRecording() {
  try {
    const text = await speech.stop();
    ui.mic.classList.remove('recording', 'working');
    if (!text) return setStatus('Nichts verstanden – bitte noch einmal.', 'error');
    ui.input.value = text;
    await runCommand(text);
  } catch (e) {
    ui.mic.classList.remove('recording', 'working');
    reportError(e, 'Spracherkennung fehlgeschlagen.');
  }
}

// ---------------------------------------------------------------------------
// Fehler, Einstellungen, Ereignisse
// ---------------------------------------------------------------------------

function reportError(e, msg = 'Fehler') {
  console.error(e);
  setStatus(`${msg} ${e?.message ? `(${e.message})` : ''}`, 'error');
}

ui.open.addEventListener('click', pickFile);
ui.open2.addEventListener('click', pickFile);
ui.fileInput.addEventListener('change', () => ui.fileInput.files[0] && openFile(ui.fileInput.files[0]));
ui.tabOriginal.addEventListener('click', () => showView('original'));
ui.tabResult.addEventListener('click', () => showView('result'));
ui.mark.addEventListener('click', () => setMarkMode(!viewerOriginal.markMode));
ui.form.addEventListener('submit', (e) => { e.preventDefault(); ui.input.blur(); runCommand(ui.input.value); });
ui.mic.addEventListener('click', toggleMic);
ui.undo.addEventListener('click', undo);
ui.apply.addEventListener('click', applyRedaction);
ui.save.addEventListener('click', () => save(true));

ui.setModel.value = settings.model;
ui.setDpi.value = String(settings.dpi);
ui.setRasterAll.checked = settings.rasterAll;
ui.btnSettings.addEventListener('click', () => ui.settings.showModal());
ui.settings.addEventListener('close', () => {
  settings.model = ui.setModel.value;
  settings.dpi = Number(ui.setDpi.value);
  if (settings.rasterAll !== ui.setRasterAll.checked && state.result) changed();
  settings.rasterAll = ui.setRasterAll.checked;
  speech.model = settings.model;
  storeSettings();
});
ui.clearModel.addEventListener('click', async () => {
  await caches.delete('transformers-cache').catch(() => {});
  try { Object.keys(localStorage).filter((k) => k.startsWith('pdfredact.model.')).forEach((k) => localStorage.removeItem(k)); } catch { /* egal */ }
  speech.ready = false;
  speech.loading = null;
  toast('Sprachmodell gelöscht.');
});

// Datei per Drag & Drop (Desktop)
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

// Offline-Fähigkeit (App-Dateien im Gerät zwischenspeichern)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Für automatisierte Tests
window.__pdfRedact = { state, runCommand, openFile, applyRedaction };
