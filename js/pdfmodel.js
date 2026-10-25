// Textmodell einer PDF-Seite: durchsuchbarer Text + Zuordnung jedes Zeichens zu seiner Position.

let measureCtx = null;
function measure(str, family) {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  measureCtx.font = `100px ${family || 'sans-serif'}`;
  return measureCtx.measureText(str).width;
}

function separator(prev, it) {
  if (/\s$/.test(prev.str) || /^\s/.test(it.str)) return '';
  const [a, b, c, d] = it.transform;
  const fs = Math.hypot(c, d) || it.height || 10;
  const horizontal = Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 && Math.abs(prev.transform[1]) < 1e-3;
  if (!horizontal) return ' ';
  if (Math.abs(it.transform[5] - prev.transform[5]) > fs * 0.5) return '\n';
  const gap = it.transform[4] - (prev.transform[4] + prev.width * Math.sign(a || 1));
  return gap > fs * 0.15 ? ' ' : '';
}

/**
 * Liest Text (inkl. Formularfeldwerte und Kommentare) einer Seite.
 * Rückgabe: { text, map, items, styles, annots, hasAnnots }
 *  map[i] = [itemIndex, charIndex] für Seitentext, [-1 - annotIndex, 0] für Annotationen, null für Trenner.
 */
export async function buildPageModel(page) {
  const tc = await page.getTextContent();
  let text = '';
  const map = [];
  const items = [];
  let prev = null;
  const push = (s, ref) => { for (let k = 0; k < s.length; k++) { text += s[k]; map.push(ref ? [ref[0], k] : null); } };

  for (const it of tc.items) {
    if (it.str === undefined) continue;
    if (!it.str) { if (it.hasEOL && text && !text.endsWith('\n')) push('\n'); prev = null; continue; }
    const idx = items.length;
    items.push(it);
    if (prev) push(separator(prev, it));
    for (let k = 0; k < it.str.length; k++) { text += it.str[k]; map.push([idx, k]); }
    if (it.hasEOL) { push('\n'); prev = null; } else prev = it;
  }

  // Annotationen: Formularwerte, Kommentare, Freitext. Sie werden beim Schwärzen flachgerechnet.
  const annots = [];
  let hasAnnots = false;
  for (const a of await page.getAnnotations()) {
    if (a.subtype === 'Link' || a.subtype === 'Popup') continue;
    hasAnnots = true;
    const strings = [];
    const add = (v) => { if (typeof v === 'string' && v.trim()) strings.push(v); else if (Array.isArray(v)) v.forEach(add); };
    add(a.fieldValue); add(a.contentsObj?.str); add(a.textContent); add(a.alternativeText); add(a.titleObj?.str);
    add(a.options?.map((o) => o.displayValue));
    if (!strings.length) continue;
    const ai = annots.length;
    annots.push(a);
    push('\n');
    const s = strings.join('\n');
    for (let k = 0; k < s.length; k++) { text += s[k]; map.push([-1 - ai, k]); }
  }

  return { text, map, items, styles: tc.styles, annots, hasAnnots };
}

/** Viereck (4 Punkte, PDF-Koordinaten) für Zeichen [c0, c1) eines Textelements. */
function itemQuad(it, style, c0, c1) {
  const [a, b, c, d, e, f] = it.transform;
  const lenU = Math.hypot(a, b) || 1;
  const fs = Math.hypot(c, d) || it.height || lenU;
  const ux = a / lenU, uy = b / lenU;
  const vx = c / (Math.hypot(c, d) || 1), vy = d / (Math.hypot(c, d) || 1);
  const W = style?.vertical ? it.height : it.width;

  let f0 = c0 / it.str.length, f1 = c1 / it.str.length;
  const full = measure(it.str, style?.fontFamily);
  if (full > 0) {
    f0 = measure(it.str.slice(0, c0), style?.fontFamily) / full;
    f1 = measure(it.str.slice(0, c1), style?.fontFamily) / full;
  }
  // Großzügiger Rand: lieber etwas zu viel schwärzen als einen Buchstabenrest stehen lassen.
  const pad = fs * 0.15;
  const x0 = f0 * W - pad, x1 = f1 * W + pad;
  const y0 = -fs * 0.32, y1 = fs * 1.05;
  const P = (x, y) => [e + ux * x + vx * y, f + uy * x + vy * y];
  return [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
}

function annotQuad(a) {
  const [x1, y1, x2, y2] = a.rect;
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}

/** Alle Vierecke, die den Textbereich [start, end) abdecken. */
export function quadsForRange(model, start, end) {
  const quads = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (cur.item < 0) quads.push(annotQuad(model.annots[-1 - cur.item]));
    else {
      const it = model.items[cur.item];
      quads.push(itemQuad(it, model.styles[it.fontName], cur.c0, cur.c1));
    }
    cur = null;
  };
  for (let i = start; i < end; i++) {
    const ref = model.map[i];
    if (!ref) continue;
    const [item, ch] = ref;
    if (cur && cur.item === item && ch === cur.c1) cur.c1 = ch + 1;
    else if (cur && cur.item === item && item < 0) { /* gleiche Annotation */ }
    else { flush(); cur = { item, c0: ch, c1: ch + 1 }; }
  }
  flush();
  return quads;
}

function bbox(q) {
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function overlaps(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * Der Text, der nach dem Schwärzen übrig bleibt – als unsichtbare Textebene für Bildseiten,
 * damit nicht geschwärzter Text weiterhin durchsuchbar und kopierbar ist.
 * excluded: Set der Zeichenpositionen (Seitentext), die entfernt werden.
 * blockQuads: Flächen (z. B. manuell markiert); Textelemente, die sie berühren, entfallen komplett.
 */
export function remainingTextRuns(model, excluded, blockQuads = []) {
  const blocks = blockQuads.map(bbox);
  const keep = model.items.map((it) => {
    const q = itemQuad(it, model.styles[it.fontName], 0, it.str.length);
    return !blocks.some((b) => overlaps(bbox(q), b));
  });
  const runs = [];
  let cur = null;
  const flush = () => { if (cur && cur.str.trim()) runs.push(cur); cur = null; };
  model.map.forEach((ref, i) => {
    if (!ref || ref[0] < 0 || excluded.has(i) || !keep[ref[0]]) return flush();
    const [item, ch] = ref;
    if (cur && cur.item === item && cur.c1 === ch) { cur.str += model.text[i]; cur.c1++; return; }
    flush();
    cur = { item, c0: ch, c1: ch + 1, str: model.text[i] };
  });
  flush();
  return runs.map((r) => {
    const it = model.items[r.item];
    const [a, b, c, d] = it.transform;
    const size = Math.hypot(c, d) || it.height || 10;
    const quad = itemQuad(it, model.styles[it.fontName], r.c0, r.c1);
    // Grundlinienpunkt am Anfang des Abschnitts (Rand wieder herausrechnen)
    const pad = size * 0.15, lenU = Math.hypot(a, b) || 1;
    const [qx, qy] = quad[0];
    const vx = c / (Math.hypot(c, d) || 1), vy = d / (Math.hypot(c, d) || 1);
    const x = qx + (a / lenU) * pad - vx * -size * 0.32;
    const y = qy + (b / lenU) * pad - vy * -size * 0.32;
    return { str: r.str, x, y, size, angle: (Math.atan2(b, a) * 180) / Math.PI };
  });
}
