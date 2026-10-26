// Texterkennung (OCR) für gescannte Seiten – komplett auf dem Gerät mit Tesseract.
// Wie im Projekt „PKV Belege“: Tesseract.js 7 und das kompakte deutsche Modell (best_int, ca. 1,3 MB)
// liefert die App selbst aus (vendor/tesseract) – kein Abruf von fremden Servern.
// Zusätzlich wird hier die Lage jedes Worts genutzt, damit Funde auf dem Bild geschwärzt werden können.

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const OCR_WIDTH = 2000; // Pixel – bewährt im Projekt PKV Belege
let worker = null;
let progressHandler = null;

async function getWorker() {
  worker ??= (async () => {
    const { createWorker, OEM } = (await import('../vendor/tesseract/tesseract.esm.min.js')).default;
    const w = await createWorker('deu', OEM.LSTM_ONLY, {
      workerPath: `${BASE}worker.min.js`,
      corePath: BASE,
      langPath: BASE,
      gzip: true,
      workerBlobURL: false, // Content-Security-Policy: Worker nur von der eigenen Seite
      logger: (m) => progressHandler?.(m),
    });
    // Seitensegmentierung „automatisch“, Leerzeichen zwischen Wörtern erhalten
    await w.setParameters({ preserve_interword_spaces: '1' });
    return w;
  })();
  try { return await worker; } catch (e) { worker = null; throw e; }
}

/** Seite als Bild rendern (weißer Hintergrund) – Grundlage für die Texterkennung. */
async function renderForOcr(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(OCR_WIDTH / base.width, 3000 / base.height); // iPhone-Speicher schonen
  const view = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(view.width);
  canvas.height = Math.round(view.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view, annotationMode: 1 }).promise;
  return { canvas, view };
}

/**
 * Erkennt die Wörter einer Seite. Rückgabe: Zeilen mit Wörtern in Bildpixeln
 * [{ words: [{ text, x0, y0, x1, y1, conf }], baseline }], plus Umrechnung ins PDF-Koordinatensystem.
 */
export async function ocrPage(page, onProgress) {
  progressHandler = onProgress;
  const w = await getWorker();
  const { canvas, view } = await renderForOcr(page);
  const { data } = await w.recognize(canvas, {}, { blocks: true, text: false });
  canvas.width = canvas.height = 0;
  progressHandler = null;
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = (line.words || [])
          .filter((wd) => wd.text && wd.text.trim())
          .map((wd) => ({ text: wd.text.trim(), conf: wd.confidence, ...wd.bbox }));
        if (words.length) lines.push({ words, baseline: line.baseline });
      }
    }
  }
  return { lines, view };
}

/** Durchschnittliche Erkennungssicherheit (0–100) – für den Hinweis in der Liste. */
export function ocrConfidence(lines) {
  const ws = lines.flatMap((l) => l.words);
  return ws.length ? ws.reduce((n, w) => n + (w.conf || 0), 0) / ws.length : 0;
}
