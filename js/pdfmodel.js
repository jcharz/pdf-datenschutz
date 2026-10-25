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
  // Großer Abstand = andere Spalte (Infoblock neben Adresse, Tabellenzellen) → eigene Zeile
  if (gap > fs * 2.2 || gap < -fs) return '\n';
  return gap > fs * 0.15 ? ' ' : '';
}

/**
 * Zeilen (bzw. Spaltenabschnitte) einer Seite mit Lage: x0/x1/y in PDF-Punkten, y von oben gemessen.
 * Zeilen aus Formularfeldern/Kommentaren haben keine Lage (x0 = null).
 */
function buildLines(text, map, items, view) {
  const [vx0, , , vy1] = view;
  const lines = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i < text.length && text[i] !== '\n') continue;
    let s = start, e = i;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) {
      const its = new Set();
      for (let k = s; k < e; k++) if (map[k] && map[k][0] >= 0) its.add(map[k][0]);
      const geo = [...its].map((n) => items[n]);
      if (geo.length) {
        const sizes = geo.map((it) => Math.hypot(it.transform[2], it.transform[3]) || it.height || 10);
        const first = items[map[s]?.[0]] || geo[0];
        lines.push({
          start: s, end: e, text: text.slice(s, e),
          x0: first.transform[4] - vx0,
          x1: Math.max(...geo.map((it) => it.transform[4] + it.width)) - vx0,
          y: vy1 - first.transform[5],
          size: Math.max(...sizes),
        });
      } else lines.push({ start: s, end: e, text: text.slice(s, e), x0: null, x1: null, y: null, size: 0 });
    }
    start = i + 1;
  }
  return lines;
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
    // pdf.js füllt Lücken zwischen Spalten mit einem breiten Leerzeichen → als Spaltenwechsel behandeln
    const fs0 = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
    if (!it.str.trim() && it.width > fs0 * 2.2) { if (text && !text.endsWith('\n')) push('\n'); prev = null; continue; }
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

  const [vx0, vy0, vx1, vy1] = page.view;
  return {
    text, map, items, styles: tc.styles, annots, hasAnnots,
    width: vx1 - vx0, height: vy1 - vy0, lines: buildLines(text, map, items, page.view),
  };
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

/** Geometrie eines Teilstücks [c0, c1) eines Textelements: Grundlinie, Schriftgröße, Breite, Drehung. */
function itemGeometry(it, style, c0, c1) {
  const [a, b, c, d, e, f] = it.transform;
  const lenU = Math.hypot(a, b) || 1;
  const size = Math.hypot(c, d) || it.height || lenU;
  const W = style?.vertical ? it.height : it.width;
  let f0 = c0 / it.str.length, f1 = c1 / it.str.length;
  const full = measure(it.str, style?.fontFamily);
  if (full > 0) {
    f0 = measure(it.str.slice(0, c0), style?.fontFamily) / full;
    f1 = measure(it.str.slice(0, c1), style?.fontFamily) / full;
  }
  const ux = a / lenU, uy = b / lenU;
  return {
    baseline: [e + ux * f0 * W, f + uy * f0 * W],
    width: (f1 - f0) * W,
    size,
    angle: Math.atan2(b, a),
    family: style?.fontFamily || 'sans-serif',
  };
}

/**
 * Teilstücke, die den Textbereich [start, end) abdecken – je Textelement eines.
 * Rückgabe: [{ quad, geom }] (geom fehlt bei Formularfeldern/Kommentaren).
 */
export function segmentsForRange(model, start, end) {
  const segs = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (cur.item < 0) segs.push({ quad: annotQuad(model.annots[-1 - cur.item]) });
    else {
      const it = model.items[cur.item];
      const style = model.styles[it.fontName];
      segs.push({ quad: itemQuad(it, style, cur.c0, cur.c1), geom: itemGeometry(it, style, cur.c0, cur.c1) });
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
  return segs;
}

/** Alle Vierecke, die den Textbereich [start, end) abdecken. */
export function quadsForRange(model, start, end) {
  return segmentsForRange(model, start, end).map((s) => s.quad);
}

// ---------------------------------------------------------------------------
// Bilder auf der Seite (Unterschriften, Fotos, Stempel, eingescannte Seiten)
// ---------------------------------------------------------------------------

function mul(m, n) {
  // erst n, dann m anwenden
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Findet gezeichnete Bilder und liefert ihre Fläche (PDF-Koordinaten) und den Anteil an der Seite. */
export async function findImages(page, OPS) {
  const list = await page.getOperatorList();
  const [vx0, vy0, vx1, vy1] = page.view;
  const pageArea = Math.abs((vx1 - vx0) * (vy1 - vy0)) || 1;
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const IMG = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject].filter(Boolean));
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = mul(ctm, [...args[0]]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (IMG.has(fn)) {
      const P = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
      const quad = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
      const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
      const w = Math.min(Math.max(...xs), vx1) - Math.max(Math.min(...xs), vx0);
      const h = Math.min(Math.max(...ys), vy1) - Math.max(Math.min(...ys), vy0);
      if (w <= 0 || h <= 0) return;
      const share = (w * h) / pageArea;
      if (share >= 0.002) out.push({ quad, share });
    }
  });
  return out;
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
    const g = itemGeometry(it, model.styles[it.fontName], r.c0, r.c1);
    return { str: r.str, x: g.baseline[0], y: g.baseline[1], size: g.size, angle: (g.angle * 180) / Math.PI };
  });
}
