// End-to-End-Test im echten Browser (Chromium/Playwright):
// Test-PDF erzeugen → App öffnen → automatische Funde prüfen → schwärzen/ersetzen → Ergebnis gründlich prüfen
// → dasselbe PDF erneut öffnen und prüfen, ob die Ersatzwerte aus der Tabelle wieder vorgeschlagen werden.
// Aufruf: node tests/e2e.cjs   (startet selbst einen lokalen Webserver)

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdf-lib/pdf-lib.min.js');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.E2E_OUT || os.tmpdir();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const IBAN = 'DE89 3704 0044 0532 0130 00';
const SECRETS = ['max.mustermann@example.de', IBAN, 'Mustermann', '0221 / 123 456-78', '12 150380 M 123', 'KV-4711/0815', 'GEHEIMPROJEKT', 'Diabetes'];

async function makePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle('Vertrag Max Mustermann');
  doc.setAuthor('Max Mustermann');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595, 842]);
  const lines = [
    'Herrn Max Mustermann',
    'Musterstraße 12a',
    '50667 Köln',
    '',
    'Versicherungsnummer: 12 150380 M 123',
    'Vertragsnummer: KV-4711/0815',
    'Sehr geehrter Herr Mustermann,',
    'E-Mail: max.mustermann@example.de',
    'Telefon: 0221 / 123 456-78',
    'IBAN: DE89 3704 0044 0532 0130 00',
    'Diagnose: Diabetes',
    'Dieser Satz bleibt stehen.',
  ];
  lines.forEach((t, i) => t && p1.drawText(t, { x: 60, y: 770 - i * 24, size: 12, font, color: rgb(0, 0, 0) }));
  p1.drawText('Mustermann GEHEIMPROJEKT', { x: 60, y: 300, size: 2, font, color: rgb(1, 1, 1) });
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Seite zwei bleibt als Text erhalten.', { x: 60, y: 760, size: 13, font });
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

function rawText(buf) {
  let out = buf.toString('latin1');
  const rx = /stream\r?\n/g;
  let m;
  while ((m = rx.exec(out))) {
    const start = m.index + m[0].length;
    const end = out.indexOf('endstream', start);
    try { out += zlib.inflateSync(buf.subarray(start, end)).toString('latin1'); } catch { /* kein Flate */ }
  }
  return out + out.replace(/<([0-9A-Fa-f\s]{4,})>/g, (_, h) => Buffer.from(h.replace(/\s/g, ''), 'hex').toString('latin1'));
}

(async () => {
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const pdf = await makePdf();
  const tmp = path.join(os.tmpdir(), 'testvertrag.pdf');
  fs.writeFileSync(tmp, pdf);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => { if (!r.url().startsWith(url) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });

  let failed = 0;
  const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };

  await page.goto(url);
  await page.screenshot({ path: path.join(OUT, 'e2e-0-start.png') });
  await page.setInputFiles('#fileInput', tmp);
  await page.waitForFunction(() => window.__pdfPrivacy.state.findings.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'e2e-1-funde.png') });

  const findings = await page.evaluate(() => window.__pdfPrivacy.state.findings.map((f) => ({ cat: f.cat, label: f.label, value: f.value, risk: f.risk, action: f.action, fake: f.fake })));
  console.log(findings.map((f) => `  ${f.risk.padEnd(7)} ${f.label.padEnd(22)} ${f.value}  [${f.action}]  → ${f.fake}`).join('\n'));
  const has = (v) => findings.some((f) => f.value === v || (f.cat === 'block' && f.value.includes(v)));
  for (const v of ['Max Mustermann', IBAN, '12 150380 M 123', 'KV-4711/0815', 'max.mustermann@example.de', '0221 / 123 456-78', 'Musterstraße 12a', '50667 Köln', 'Diabetes']) {
    check(has(v), `Automatisch erkannt: ${v}`);
  }
  check(findings.every((f) => f.risk !== 'hoch' || f.action !== 'keep'), 'Alle Funde mit hohem Risiko sind vorausgewählt');

  // IBAN, Name und E-Mail ersetzen, Rest schwärzen
  await page.evaluate(() => {
    const { state, setAction } = window.__pdfPrivacy;
    for (const f of state.findings) if (['iban', 'names', 'email', 'svnr'].includes(f.cat)) setAction(f, 'replace');
  });
  const fakes = await page.evaluate(() => Object.fromEntries(window.__pdfPrivacy.state.findings.filter((f) => f.action === 'replace').map((f) => [f.cat, f.fake])));
  check(/^DE\d{2} \d{4} \d{4} \d{4} \d{4} \d{2}$/.test(fakes.iban), `Ersatz-IBAN hat dieselbe Struktur: ${fakes.iban}`);

  // Hinweis per Texteingabe (entspricht Diktat)
  if (!(await page.evaluate(() => document.getElementById('sheet').classList.contains('open')))) await page.click('#sheetHead');
  await page.fill('#hintInput', 'auch Geheimprojekt');
  await page.press('#hintInput', 'Enter');
  await page.waitForTimeout(200);
  check(await page.evaluate(() => window.__pdfPrivacy.state.findings.some((f) => f.cat === 'hint' && /GEHEIMPROJEKT/.test(f.value))), 'Hinweis „auch Geheimprojekt“ findet versteckten Text');
  await page.screenshot({ path: path.join(OUT, 'e2e-2-liste.png') });
  await page.click('#scrim', { position: { x: 200, y: 40 } });

  // Lupe + Wischen
  await page.click('#btnZoom');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, 'e2e-3-lupe.png') });
  const swipe = async (dx, dy) => {
    const b = await page.locator('#viewer').boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(350);
  };
  await swipe(-120, 0);
  let v = await page.evaluate(() => ({ q: window.__pdfPrivacy.viewer.q, i: window.__pdfPrivacy.viewer.index }));
  check(v.q === 1 && v.i === 0, 'Wischen nach links → Viertel oben rechts');
  await swipe(-120, 0); await swipe(-120, 0);
  v = await page.evaluate(() => ({ q: window.__pdfPrivacy.viewer.q, i: window.__pdfPrivacy.viewer.index }));
  check(v.q === 3, 'Weiter wischen → unten rechts');
  await swipe(-120, 0);
  await page.waitForTimeout(400);
  v = await page.evaluate(() => ({ q: window.__pdfPrivacy.viewer.q, i: window.__pdfPrivacy.viewer.index }));
  check(v.q === 0 && v.i === 1, 'Nach dem letzten Viertel → nächste Seite oben links');
  await swipe(120, 0);
  await page.waitForTimeout(400);
  await page.click('#btnZoom');
  await swipe(120, 0);
  await page.waitForTimeout(400);
  v = await page.evaluate(() => ({ z: window.__pdfPrivacy.viewer.zoom, i: window.__pdfPrivacy.viewer.index }));
  check(!v.z && v.i === 0, 'Lupe aus, zurück auf Seite 1');

  // Anwenden
  await page.click('#btnPrimary');
  await page.waitForFunction(() => window.__pdfPrivacy.state.result, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'e2e-4-nachher.png') });
  const verify = await page.textContent('#verify');
  console.log('Prüfbericht:', verify);
  const outBytes = Buffer.from(await page.evaluate(() => Array.from(window.__pdfPrivacy.state.result.bytes)));
  fs.writeFileSync(path.join(OUT, 'testvertrag-bereinigt.pdf'), outBytes);

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
  const raw = rawText(outBytes).toLowerCase();

  check(extracted.pages === 2, 'Seitenzahl unverändert');
  for (const s of SECRETS) {
    check(!extracted.text.includes(s) && !extracted.meta.includes(s) && !raw.includes(s.toLowerCase()), `„${s}“ nirgends mehr im PDF`);
  }
  check(extracted.text.includes(fakes.iban), 'Ersatz-IBAN steht im Ergebnis (durchsuchbar)');
  check(extracted.text.includes('Dieser Satz bleibt stehen.'), 'Nicht betroffener Text bleibt durchsuchbar');
  check(extracted.text.includes('Seite zwei bleibt als Text erhalten.'), 'Unbetroffene Seite bleibt erhalten');
  check(!extracted.attachments, 'Keine Dateianhänge mehr');
  check(verify.includes('✓'), 'App-eigene Prüfung meldet Erfolg');

  // Tabelle: Originale nicht im Klartext gespeichert
  const stored = await page.evaluate(() => localStorage.getItem('pdfprivacy.pseudonyms'));
  check(stored && !stored.includes('Mustermann') && !stored.includes('3704') && stored.includes(fakes.iban), 'Tabelle enthält Ersatzwerte, aber keine Originale');

  // Vorher/Nachher an derselben Stelle
  await page.click('#tabOriginal');
  await page.waitForTimeout(300);
  await page.click('#tabResult');
  await page.waitForTimeout(300);

  // Dasselbe Dokument erneut öffnen → Ersatzwerte werden wiedererkannt
  await page.setInputFiles('#fileInput', tmp);
  await page.waitForFunction(() => !window.__pdfPrivacy.state.result && window.__pdfPrivacy.state.findings.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => window.__pdfPrivacy.state.findings.map((f) => ({ cat: f.cat, fake: f.fake, known: f.known, action: f.action })));
  const iban2 = again.find((f) => f.cat === 'iban');
  check(iban2.known && iban2.fake === fakes.iban && iban2.action === 'replace', 'Bekannte IBAN: gleicher Ersatz wird vorgeschlagen');
  check(again.find((f) => f.cat === 'names')?.fake === fakes.names, 'Bekannter Name: gleicher Ersatz wird vorgeschlagen');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'e2e-5-bekannt.png') });

  // Bedienung auf dem iPhone: Leiste verdeckt nichts, Wischen klappt die Liste auf/zu, ✕ schließt das Dokument
  await page.evaluate(() => { const s = document.getElementById('sheet'); s.classList.remove('open'); document.getElementById('scrim').hidden = true; });
  await page.waitForTimeout(300);
  const box = async (sel) => page.locator(sel).boundingBox();
  const [tb, sh, vw] = [await box('#toolbar'), await box('#sheet'), await box('#viewer')];
  check(tb.y + tb.height <= sh.y + 1 && vw.y + vw.height <= tb.y + 1, `Werkzeugleiste und Seite nicht von der Leiste verdeckt (Leiste ${Math.round(sh.height)} px hoch)`);
  const bar = await box('#sheetHead');
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 20); await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y - 80, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.getElementById('sheet').classList.contains('open')), 'Nach oben wischen öffnet die Liste');
  await page.screenshot({ path: path.join(OUT, 'e2e-7-liste-offen.png') });
  const bar2 = await box('#sheetHead');
  await page.mouse.move(bar2.x + bar2.width / 2, bar2.y + 10); await page.mouse.down();
  await page.mouse.move(bar2.x + bar2.width / 2, bar2.y + 120, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.getElementById('sheet').classList.contains('open')), 'Nach unten wischen schließt die Liste');
  await page.screenshot({ path: path.join(OUT, 'e2e-8-liste-zu.png') });
  page.once('dialog', (d) => d.accept());
  await page.click('#btnClose');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.getElementById('empty').hidden && !window.__pdfPrivacy.state.doc), '✕ schließt das Dokument (Startbildschirm)');

  check(!external.length, `Keine Verbindungen nach außen ${external.join(' ')}`);
  check(!errors.length, `Keine JS-Fehler ${errors.join('; ')}`);

  // Dunkler Modus (nur Bildschirmfoto)
  const dark = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await dark.goto(url);
  await dark.setInputFiles('#fileInput', tmp);
  await dark.waitForFunction(() => window.__pdfPrivacy.state.findings.length > 0);
  await dark.waitForTimeout(400);
  await dark.screenshot({ path: path.join(OUT, 'e2e-6-dunkel.png') });

  await browser.close();
  srv.close();
  console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : '\nAlle Prüfungen bestanden');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
