// Sicheres Schwärzen: Betroffene Seiten werden als Bild neu aufgebaut (der Text existiert danach
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

/** Rendert eine Seite als Bild und malt die Schwärzungen direkt in die Pixel. */
async function rasterizePage(page, quads, dpi) {
  const base = page.getViewport({ scale: 1 });
  let scale = dpi / 72;
  if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // annotationMode 1 = ENABLE: Formularfelder & Kommentare werden sichtbar ins Bild übernommen
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 1 }).promise;
  ctx.fillStyle = '#000';
  for (const q of quads) {
    ctx.beginPath();
    q.forEach(([x, y], i) => {
      const [px, py] = vp.convertToViewportPoint(x, y);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
  }
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
 * Erzeugt das geschwärzte PDF.
 * redactions: Map<pageIndex, { quads, excluded: Set<Zeichenindex>, blockQuads }>; models: Textmodelle der Originalseiten.
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
  const stats = { rasterized: 0, copied: 0, boxes: 0 };

  for (let i = 0; i < pdfDoc.numPages; i++) {
    onProgress?.(i + 1, pdfDoc.numPages);
    const red = redactions.get(i) || { quads: [], excluded: new Set(), blockQuads: [] };
    const quads = red.quads;
    stats.boxes += quads.length;
    if (rasterAll || quads.length || models[i].hasAnnots) {
      const page = await pdfDoc.getPage(i + 1);
      const { jpg, width, height } = await rasterizePage(page, quads, dpi);
      const img = await out.embedJpg(jpg);
      const p = out.addPage([width, height]);
      p.drawImage(img, { x: 0, y: 0, width, height });
      // Seitenbild beginnt bei (0,0); Original-Koordinaten ggf. verschieben (CropBox-Ursprung, Drehung)
      const vp = page.getViewport({ scale: 1 });
      if (!vp.rotation) {
        const [x0, y0] = page.view;
        const runs = remainingTextRuns(models[i], red.excluded, red.blockQuads)
          .map((r) => ({ ...r, x: r.x - x0, y: r.y - y0 }));
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
