// End-to-End-Test im echten Browser (Chromium/Playwright):
// Test-PDF erzeugen → App öffnen → Befehle eingeben → schwärzen → Ergebnis gründlich prüfen.
// Aufruf: node tests/e2e.cjs   (startet selbst einen lokalen Webserver)

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdf-lib/pdf-lib.min.js');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const SECRETS = ['max.mustermann@example.de', 'DE89 3704 0044 0532 0130 00', 'Mustermann', '0221 / 123 456-78', '4711-0815', 'GEHEIMPROJEKT'];

async function makePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Vertrag Max Mustermann');
  doc.setAuthor('Max Mustermann');
  doc.setKeywords(['max.mustermann@example.de']);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  const lines = [
    'Sehr geehrter Herr Max Mustermann,',
    'Ihre Kundennummer: 4711-0815',
    'E-Mail: max.mustermann@example.de',
    'Telefon: 0221 / 123 456-78',
    'IBAN: DE89 3704 0044 0532 0130 00',
    'Dieser Satz bleibt stehen.',
  ];
  lines.forEach((t, i) => p1.drawText(t, { x: 60, y: 760 - i * 28, size: 13, font, color: rgb(0, 0, 0) }));
  // Unsichtbarer Text (weiß, winzig) – muss ebenfalls gefunden und entfernt werden
  p1.drawText('Mustermann GEHEIMPROJEKT', { x: 60, y: 300, size: 2, font, color: rgb(1, 1, 1) });
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Seite zwei ohne personenbezogene Inhalte.', { x: 60, y: 760, size: 13, font });
  // Formularfeld mit Namen
  const form = doc.getForm();
  const tf = form.createTextField('kunde');
  tf.setText('Mustermann');
  tf.addToPage(p2, { x: 60, y: 600, width: 200, height: 24 });
  const p3 = doc.addPage([595, 842]);
  p3.drawText('Seite drei bleibt als Text erhalten.', { x: 60, y: 760, size: 13, font });
  doc.attach(Buffer.from('Max Mustermann'), 'notiz.txt', { mimeType: 'text/plain' });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(rsp);
    });
    srv.listen(0, () => res(srv));
  });
}

/** Alle Flate-Streams entpacken und zusammen mit dem Rohinhalt als Text liefern. */
function rawText(buf) {
  let out = buf.toString('latin1');
  const rx = /stream\r?\n/g;
  let m;
  while ((m = rx.exec(out))) {
    const start = m.index + m[0].length;
    const end = out.indexOf('endstream', start);
    try { out += zlib.inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { /* kein Flate */ }
  }
  // Hex-Strings <4D7573...> (so schreiben viele Programme Text in Inhaltsströme)
  return out + out.replace(/<([0-9A-Fa-f\s]{4,})>/g, (_, h) => Buffer.from(h.replace(/\s/g, ''), 'hex').toString('latin1'));
}

(async () => {
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const pdf = await makePdf();
  const tmp = path.join(require('os').tmpdir(), 'testvertrag.pdf');
  fs.writeFileSync(tmp, pdf);
  const before = rawText(pdf);
  for (const s of ['Mustermann', 'max.mustermann@example.de']) if (!before.includes(s)) throw new Error(`Testaufbau: ${s} fehlt im Original`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.setInputFiles('#fileInput', tmp);
  await page.waitForFunction(() => window.__pdfRedact.state.models.length === 3);

  const commands = [
    'Entferne alle E-Mail-Adressen und Telefonnummern.',
    'Schwärze den Namen Max Mustermann',
    'Lösche die IBAN',
    'Entferne die Kundennummer',
    'Entferne das Wort Geheimprojekt',
  ];
  for (const c of commands) {
    await page.fill('#cmdInput', c);
    await page.press('#cmdInput', 'Enter');
  }
  const summary = await page.evaluate(() => window.__pdfRedact.state.rules.map((r) => `${r.kind}:${r.cat || r.term} → ${r.matches.map((m) => m.text).join(' | ')}`));
  console.log(summary.join('\n'));

  // „Rückgängig“ per Befehl und manuelles Markieren einer Fläche auf Seite 3
  await page.fill('#cmdInput', 'Entferne das Wort bleibt');
  await page.press('#cmdInput', 'Enter');
  await page.fill('#cmdInput', 'rückgängig');
  await page.press('#cmdInput', 'Enter');
  const ruleCount = await page.evaluate(() => window.__pdfRedact.state.rules.length);
  await page.click('#btnMark');
  const svg = page.locator('.page[data-index="2"] svg');
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await page.click('#btnMark');
  const manual = await page.evaluate(() => window.__pdfRedact.state.manual?.matches.length || 0);

  await page.fill('#cmdInput', 'schwärzen');
  await page.press('#cmdInput', 'Enter');
  await page.waitForFunction(() => window.__pdfRedact.state.result, null, { timeout: 60000 });
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'e2e-result.png') });
  const verify = await page.textContent('#verify');
  console.log('Prüfbericht:', verify);
  const outBytes = Buffer.from(await page.evaluate(() => Array.from(window.__pdfRedact.state.result.bytes)));
  fs.writeFileSync(path.join(require('os').tmpdir(), 'testvertrag-geschwaerzt.pdf'), outBytes);

  // Unabhängige Prüfung: Text des Ergebnisses mit pdf.js extrahieren und Rohdaten durchsuchen
  const extracted = await page.evaluate(async (b64) => {
    const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfjs.getDocument({ data }).promise;
    let t = '';
    for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
    const meta = await doc.getMetadata();
    return { text: t, meta: JSON.stringify(meta.info), attachments: await doc.getAttachments(), pages: doc.numPages };
  }, outBytes.toString('base64'));
  const raw = rawText(outBytes);

  let failed = 0;
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };
  check(extracted.pages === 3, 'Seitenzahl unverändert');
  for (const s of SECRETS) {
    check(!extracted.text.includes(s) && !extracted.meta.includes(s), `„${s}“ nicht im extrahierten Text/Metadaten`);
    check(!raw.toLowerCase().includes(s.toLowerCase()), `„${s}“ nicht in den Rohdaten`);
  }
  check(!extracted.attachments, 'Keine Dateianhänge mehr');
  check(ruleCount === 6, '„Rückgängig“ entfernt die letzte Regel');
  check(manual === 1, 'Manuell markierter Bereich erfasst');
  check(verify.includes('3 Seite(n) neu als Bild'), 'Seite mit manueller Markierung als Bild neu aufgebaut');
  check(extracted.text.includes('Dieser Satz bleibt stehen.'), 'Nicht geschwärzter Text bleibt durchsuchbar (unsichtbare Textebene)');
  check(verify.includes('✓'), 'App-eigene Prüfung meldet Erfolg');
  check(!errors.length, `Keine JS-Fehler ${errors.join('; ')}`);

  await browser.close();
  srv.close();
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
