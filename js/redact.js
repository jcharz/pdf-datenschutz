// Sicheres Schwärzen und Ersetzen: Betroffene Seiten werden als Bild neu aufgebaut (der Text existiert danach
// nicht mehr), alle übrigen Seiten werden ohne Metadaten, Kommentare, Formulare, Lesezeichen,
// Anhänge und Skripte in ein komplett neues PDF übernommen. Danach wird das Ergebnis geprüft.

import { buildPageModel, remainingTextRuns } from './pdfmodel.js';
import { findMatches } from './detect.js';

const { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } = window.PDFLib;

const MAX_PIXELS = 14_000_000; // iOS-Canvas-Grenze liegt bei ~16,7 Mio. Pixeln

async function canvasToJpeg(canvas) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

function polyPath(ctx, vp, q) {
  ctx.beginPath();
  q.forEach(([x, y], i) => {
    const [px, py] = vp.convertToViewportPoint(x, y);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  });
  ctx.closePath();
}

/** Hintergrund- und Schriftfarbe im Bereich der Vierecke aus dem gerenderten Bild ablesen. */
function sampleColors(ctx, vp, quads) {
  const pts = quads.flat().map(([x, y]) => vp.convertToViewportPoint(x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.max(1, Math.min(ctx.canvas.width - x0, Math.ceil(Math.max(...xs)) - x0));
  const h = Math.max(1, Math.min(ctx.canvas.height - y0, Math.ceil(Math.max(...ys)) - y0));
  const data = ctx.getImageData(x0, y0, w, h).data;
  const px = [];
  const step = Math.max(1, Math.floor((w * h) / 4000));
  for (let i = 0; i < w * h; i += step) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    px.push([0.299 * r + 0.587 * g + 0.114 * b, r, g, b]);
  }
  px.sort((a, b) => a[0] - b[0]);
  const at = (f) => px[Math.min(px.length - 1, Math.floor(f * px.length))];
  const bg = at(0.9), fg = at(0.03);
  const css = (p) => `rgb(${p[1]},${p[2]},${p[3]})`;
  // Kaum Kontrast → schwarze Schrift auf gefundenem Hintergrund
  return { bg: css(bg), fg: bg[0] - fg[0] > 60 ? css(fg) : '#000' };
}

function lowContrast(ctx, vp, q) {
  const pts = q.map(([x, y]) => vp.convertToViewportPoint(x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.max(1, Math.min(ctx.canvas.width - x0, Math.ceil(Math.max(...xs)) - x0));
  const h = Math.max(1, Math.min(ctx.canvas.height - y0, Math.ceil(Math.max(...ys)) - y0));
  const d = ctx.getImageData(x0, y0, w, h).data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (l < min) min = l;
    if (l > max) max = l;
  }
  return max - min < 25;
}

/** Ersatztext an die Stelle des Originals malen (gleiche Grundlinie, Größe, Drehung, Farbe). */
function paintReplacement(ctx, vp, rep) {
  const quads = rep.segments.map((s) => s.quad);
  const { bg, fg } = sampleColors(ctx, vp, quads);
  ctx.fillStyle = bg;
  for (const q of quads) { polyPath(ctx, vp, q); ctx.fill(); }
  const g = rep.segments.find((s) => s.geom)?.geom;
  if (!g || !rep.text) return;
  const sameLine = rep.segments.filter((s) => s.geom && Math.abs(s.geom.baseline[1] - g.baseline[1]) < g.size * 0.5);
  const avail = sameLine.reduce((n, s) => n + s.geom.width, 0) || g.width;
  const [bx, by] = vp.convertToViewportPoint(...g.baseline);
  const px = g.size * vp.scale;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(-g.angle);
  ctx.font = `${px}px ${g.family}`;
  const textW = ctx.measureText(rep.text).width;
  const maxW = avail * vp.scale * 1.08;
  if (textW > maxW) ctx.scale(Math.max(0.6, maxW / textW), 1);
  ctx.fillStyle = fg;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(rep.text, 0, 0);
  ctx.restore();
}

/** Rendert eine Seite als Bild; Ersetzungen und Schwärzungen werden direkt in die Pixel gemalt. */
async function rasterizePage(page, red, dpi) {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // annotationMode 1 = ENABLE: Formularfelder & Kommentare werden sichtbar ins Bild übernommen
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 1 }).promise;
  for (const rep of red.replacements) paintReplacement(ctx, vp, rep);
  for (const q of red.quads) {
    // Unsichtbarer Text (z. B. weiß auf weiß) bleibt unsichtbar: Hintergrundfarbe statt schwarzem Balken
    ctx.fillStyle = lowContrast(ctx, vp, q) ? sampleColors(ctx, vp, [q]).bg : '#000';
    polyPath(ctx, vp, q);
    ctx.fill();
  }
  ctx.fillStyle = '#000';
  for (const q of red.blockQuads) { polyPath(ctx, vp, q); ctx.fill(); }
  const jpg = await canvasToJpeg(canvas);
  canvas.width = canvas.height = 0; // Speicher auf dem iPhone sofort freigeben
  return { jpg, width: base.width, height: base.height };
}

const PAGE_KEYS_TO_DROP = ['Annots', 'AA', 'Metadata', 'PieceInfo', 'Thumb', 'B', 'StructParents', 'Tabs', 'LastModified'];

/** Nicht geschwärzten Text unsichtbar über das Seitenbild legen (bleibt durchsuchbar/kopierbar). */
function addInvisibleText(page, font, runs) {
  const ok = new Map();
  const encodable = (ch) => {
    if (!ok.has(ch)) { try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
    return ok.get(ch);
  };
  for (const r of runs) {
    const str = [...r.str].map((ch) => (encodable(ch) ? ch : ' ')).join('');
    if (!str.trim() || r.size <= 0) continue;
    page.drawText(str, { x: r.x, y: r.y, size: r.size, font, opacity: 0, rotate: degrees(r.angle) });
  }
}

/**
 * Erzeugt das bereinigte PDF.
 * redactions: Map<pageIndex, { quads, replacements: [{segments, text}], excluded: Set<Zeichenindex>, blockQuads }>
 *   quads = schwarz schwärzen, replacements = Original überdecken und Ersatztext einsetzen.
 * models: Textmodelle der Originalseiten.
 */
export async function redactPdf({ bytes, pdfDoc, redactions, models, rasterAll = false, dpi = 200, onProgress }) {
  let src = null;
  try {
    src = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    rasterAll = true; // verschlüsselt oder beschädigt → jede Seite als Bild (sicherer Weg)
  }
  const out = await PDFDocument.create({ updateMetadata: false });
  const font = await out.embedFont(StandardFonts.Helvetica);
  const stats = { rasterized: 0, copied: 0, boxes: 0, replaced: 0 };

  for (let i = 0; i < pdfDoc.numPages; i++) {
    onProgress?.(i + 1, pdfDoc.numPages);
    const red = { quads: [], replacements: [], excluded: new Set(), blockQuads: [], ...redactions.get(i) };
    stats.boxes += red.quads.length + red.blockQuads.length;
    stats.replaced += red.replacements.length;
    if (rasterAll || red.quads.length || red.blockQuads.length || red.replacements.length || models[i].hasAnnots) {
      const page = await pdfDoc.getPage(i + 1);
      const { jpg, width, height } = await rasterizePage(page, red, dpi);
      const img = await out.embedJpg(jpg);
      const p = out.addPage([width, height]);
      p.drawImage(img, { x: 0, y: 0, width, height });
      // Seitenbild beginnt bei (0,0); Original-Koordinaten ggf. verschieben (CropBox-Ursprung, Drehung)
      const vp = page.getViewport({ scale: 1 });
      if (!vp.rotation) {
        const [x0, y0] = page.view;
        const runs = remainingTextRuns(models[i], red.excluded, red.blockQuads);
        for (const rep of red.replacements) {
          const g = rep.segments.find((sg) => sg.geom)?.geom;
          if (g && rep.text) runs.push({ str: rep.text, x: g.baseline[0], y: g.baseline[1], size: g.size, angle: (g.angle * 180) / Math.PI });
        }
        for (const r of runs) { r.x -= x0; r.y -= y0; }
        addInvisibleText(p, font, runs);
      }
      page.cleanup();
      stats.rasterized++;
    } else {
      const [p] = await out.copyPages(src, [i]);
      for (const k of PAGE_KEYS_TO_DROP) p.node.delete(PDFName.of(k));
      out.addPage(p);
      stats.copied++;
    }
  }

  // Neutrale Metadaten – Titel, Autor, Programm usw. des Originals werden nicht übernommen.
  out.setProducer('');
  out.setCreator('');
  const result = await out.save({ useObjectStreams: true });
  return { bytes: result, stats };
}

// ---------------------------------------------------------------------------
// Prüfung des Ergebnisses
// ---------------------------------------------------------------------------

function squash(s) {
  return s.toLowerCase().replace(/[\s­\-–]+/g, '');
}

function utf16be(s) {
  let out = '';
  for (const ch of s) { const c = ch.charCodeAt(0); out += String.fromCharCode(c >> 8, c & 255); }
  return out;
}

/** Durchsucht alle (entpackten) Datenströme und Strings des PDFs nach den entfernten Texten. */
async function rawScan(bytes, needles) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const hay = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const dict = obj.dict;
      const sub = dict.get(PDFName.of('Subtype'))?.toString();
      if (sub === '/Image' || dict.has(PDFName.of('Length1')) || /Type1C|CIDFontType0C|OpenType/.test(sub || '')) continue;
      try { hay.push(new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode())); } catch { /* nicht entpackbar */ }
    } else {
      hay.push(obj.toString());
    }
  }
  let all = hay.join('\n');
  // Hex-kodierte Strings <4D7573…> zusätzlich als Text lesen
  all += all.replace(/<([0-9A-Fa-f\s]{4,})>/g, (_, h) => {
    const hex = h.replace(/\s/g, '');
    let s = '';
    for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return s;
  });
  all = all.toLowerCase();
  return needles.filter((n) => n.length >= 4 && (all.includes(n.toLowerCase()) || all.includes(utf16be(n).toLowerCase())));
}

/**
 * Lädt das Ergebnis erneut, extrahiert sämtlichen Text, Metadaten und Annotationen und prüft,
 * dass weder die gewählten Texte noch neue Treffer der Regeln auffindbar sind.
 */
export async function verifyResult({ pdfjsLib, bytes, rules, removedTexts, keptTexts = [] }) {
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) texts.push((await buildPageModel(await doc.getPage(i))).text);
  const meta = await doc.getMetadata().catch(() => ({}));
  const metaText = JSON.stringify(meta.info || {}) + (meta.metadata ? JSON.stringify([...meta.metadata]) : '');
  const outline = JSON.stringify((await doc.getOutline()) || []);
  const attachments = await doc.getAttachments();
  await doc.destroy();

  const searchable = squash(texts.join('\n') + '\n' + metaText + '\n' + outline);
  // Texte, die an anderer Stelle bewusst stehen bleiben, nicht als Rest melden
  const kept = keptTexts.map(squash);
  const unique = [...new Set(removedTexts.map((t) => t.trim()).filter((t) => t.length >= 2))]
    .filter((t) => !kept.some((k) => k.includes(squash(t))));
  const leftInText = unique.filter((t) => searchable.includes(squash(t)));
  const leftInRaw = await rawScan(bytes, unique);
  const ruleHits = [];
  for (const rule of rules) {
    if (rule.kind === 'manual') continue;
    const n = findMatches(rule, texts).length;
    if (n) ruleHits.push({ rule, count: n });
  }
  return {
    ok: !leftInText.length && !leftInRaw.length && !attachments,
    leftInText, leftInRaw, ruleHits, attachments: !!attachments,
  };
}
