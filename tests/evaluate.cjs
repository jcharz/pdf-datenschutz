// Auswertung an Beispieldokumenten: Was wird erkannt, wem wird es zugeordnet, was fehlt, was ist zu viel?
// Aufruf: node tests/evaluate.cjs [--verbose]   (erzeugt die Beispiele selbst und startet einen lokalen Server)

const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SAMPLES, makeDoc } = require('./samples.cjs');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const verbose = process.argv.includes('--verbose');

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

const ws = (s) => s.replace(/\s+/g, ' ').trim();

const HTML_LETTER = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; }
  body { font-family: Arial, sans-serif; font-size: 10pt; margin: 0; }
  .page { position: relative; width: 210mm; height: 297mm; }
  .head { position: absolute; top: 15mm; right: 20mm; text-align: right; }
  .head b { font-size: 13pt; }
  .sender { position: absolute; top: 45mm; left: 25mm; font-size: 7pt; border-bottom: 0.5pt solid #000; }
  .to { position: absolute; top: 52mm; left: 25mm; line-height: 1.35; }
  .info { position: absolute; top: 52mm; left: 125mm; font-size: 9pt; }
  .info td { padding: 0 4mm 1mm 0; }
  .body { position: absolute; top: 105mm; left: 25mm; right: 20mm; line-height: 1.45; }
  .foot { position: absolute; bottom: 10mm; left: 25mm; right: 20mm; font-size: 6.5pt; color: #333; }
</style></head><body><div class="page">
  <div class="head"><b>Nordlicht Versicherung AG</b><br>Kundenservice Leben</div>
  <div class="sender">Nordlicht Versicherung AG · Hafenkante 12 · 20457 Hamburg</div>
  <div class="to">Frau<br>Dr. Johanna Albrecht<br>Kastanienweg 9 b<br>22769 Hamburg</div>
  <table class="info">
    <tr><td>Versicherungsschein-Nr.</td><td>LV 4471 2290 03</td></tr>
    <tr><td>Ihr Ansprechpartner</td><td>Tobias Brandt</td></tr>
    <tr><td>Telefon</td><td>040 3344-1290</td></tr>
    <tr><td>Datum</td><td>18.09.2024</td></tr>
  </table>
  <div class="body">
    <p><b>Ihre Lebensversicherung – Mitteilung über die Überschussbeteiligung</b></p>
    <p>Sehr geehrte Frau Dr. Albrecht,</p>
    <p>zu Ihrem Vertrag (versicherte Person: Johanna Albrecht, geb. 02.05.1979) teilen wir Ihnen mit,
    dass sich der Rückkaufswert auf 18.420,55 € erhöht hat. Die Auszahlung erfolgt auf Ihr Konto
    IBAN DE75 5121 0800 1245 1261 99.</p>
    <p>Mit freundlichen Grüßen<br>Ihre Nordlicht Versicherung AG<br><br>Tobias Brandt</p>
  </div>
  <div class="foot">Nordlicht Versicherung AG · Sitz Hamburg · Amtsgericht Hamburg HRB 99887 · Vorstand: Dr. Eva Kranz (Vors.), Paul Lenz<br>
  Hafenkante 12 · 20457 Hamburg · Telefon 040 3344-0 · www.nordlicht-beispiel.de · IBAN DE89 3704 0044 0532 0130 00</div>
</div></body></html>`;

const EXPECT_HTML = {
  person: ['Johanna Albrecht', 'Kastanienweg 9 b', '22769 Hamburg', 'LV 4471 2290 03', '02.05.1979', 'DE75 5121 0800 1245 1261 99'],
  sender: ['Hafenkante 12', 'Tobias Brandt', '040 3344-1290', 'HRB 99887', 'Eva Kranz', '040 3344-0'],
  blocks: [{ owner: 'person', contains: ['Johanna Albrecht', 'Kastanienweg 9 b', '22769 Hamburg'] }],
  exact: { 'LV 4471 2290 03': 'Versicherungsschein-Nr' },
  notPerson: ['Lebensversicherung', 'Überschussbeteiligung', 'Rückkaufswert'],
};

function evaluate(name, findings, exp) {
  const problems = [];
  const texts = (f) => [f.value, ...(f.variants || []), ...f.occ].map(ws);
  const owner = (f) => f.owner || 'person';
  const covering = (v) => findings.filter((f) => texts(f).some((t) => t.includes(ws(v))));
  let ok = 0, total = 0;
  for (const kind of ['person', 'sender']) {
    for (const v of exp[kind]) {
      total++;
      const fs = covering(v);
      if (!fs.length) problems.push(`FEHLT      [${kind}] ${v}`);
      else if (!fs.some((f) => owner(f) === kind)) problems.push(`ZUORDNUNG  [${kind}] ${v}  → als ${fs.map(owner).join('/')} (${fs.map((f) => f.label).join('/')})`);
      else ok++;
    }
  }
  for (const b of exp.blocks) {
    total++;
    const f = findings.find((x) => x.cat === 'block' && b.contains.every((c) => ws(x.value).includes(ws(c))));
    if (!f) problems.push(`KEIN BLOCK [${b.owner}] ${b.contains.join(' / ')}`);
    else if (owner(f) !== b.owner) problems.push(`BLOCK-ZUORDNUNG [${b.owner}] ${b.contains[0]} → ${owner(f)}`);
    else ok++;
  }
  for (const [v, label] of Object.entries(exp.exact)) {
    total++;
    const f = findings.find((x) => ws(x.value) === ws(v) || (x.cat === 'block' && false));
    if (!f) problems.push(`UNVOLLST.  „${v}“ nicht als ganzer Wert erkannt (${covering(v).map((x) => `„${x.value}“`).join(', ') || '–'})`);
    else if (!f.label.includes(label)) problems.push(`BEZEICHN.  „${v}“ als „${f.label}“ statt „${label}“`);
    else ok++;
  }
  // Jede einzelne Stelle dieser Werte muss bei den eigenen Daten stehen (nicht in einem behaltenen Absenderblock)
  for (const v of exp.everywherePerson || []) {
    total++;
    const bad = findings.filter((f) => owner(f) === 'sender' && f.occ.some((t) => ws(t).includes(ws(v))));
    if (bad.length) problems.push(`STELLE ALS ABSENDER  „${v}“ in ${bad.map((f) => `${f.label} (S. ${f.pages.join(',')})`).join(', ')}`);
    else ok++;
  }
  for (const w of exp.notPerson) {
    total++;
    const f = findings.find((x) => owner(x) === 'person' && x.cat !== 'block' && ws(x.value).includes(w));
    if (f) problems.push(`ZU VIEL    „${f.value}“ (${f.label}) enthält „${w}“`);
    else ok++;
  }
  // Funde, die keiner Erwartung entsprechen (zur Sichtprüfung)
  const expected = [...exp.person, ...exp.sender].map(ws);
  const extras = findings.filter((f) => !expected.some((e) => texts(f).some((t) => t.includes(e) || e.includes(ws(f.value)))));
  return { name, ok, total, problems, extras };
}

(async () => {
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'samples-'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  let sumOk = 0, sumTotal = 0;
  // Zusätzlich: ein Brief, den Chromium aus HTML druckt (andere Textzerlegung, eingebettete Schriften)
  const htmlPdf = await (async () => {
    const p2 = await browser.newPage();
    await p2.setContent(HTML_LETTER);
    const buf = await p2.pdf({ format: 'A4', printBackground: true });
    await p2.close();
    return buf;
  })();
  const all = [...SAMPLES, ['html-brief.pdf', null, EXPECT_HTML]];
  for (const [name, build, exp] of all) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, build ? await makeDoc(build) : htmlPdf);
    await page.evaluate(() => { window.__pdfPrivacy.state.findings = []; });
    await page.setInputFiles('#fileInput', file);
    await page.waitForFunction((n) => window.__pdfPrivacy.state.file?.name === n && window.__pdfPrivacy.state.findings.length > 0, name, { timeout: 30000 });
    await page.waitForTimeout(300);
    const findings = await page.evaluate(() => window.__pdfPrivacy.state.findings.map((f) => ({
      cat: f.cat, label: f.label, value: f.value, variants: f.variants, owner: f.owner, risk: f.risk, action: f.action, fake: f.fake,
      occ: f.occurrences.map((o) => o.text || ''), pages: [...new Set(f.occurrences.map((o) => o.page + 1))],
    })));
    const r = evaluate(name, findings, exp);
    sumOk += r.ok; sumTotal += r.total;
    console.log(`\n=== ${name}: ${r.ok}/${r.total}`);
    for (const p of r.problems) console.log('  ' + p);
    if (verbose || r.extras.length) {
      for (const f of r.extras) console.log(`  (weiterer Fund) ${(f.owner || 'person').padEnd(7)} ${f.risk.padEnd(7)} ${f.label}: ${ws(f.value)}`);
    }
    // Sicherheitsproben: (1) mit den Vorschlägen der App, (2) alle eigenen Daten ersetzen.
    // Danach darf keiner der eigenen Werte mehr im Ergebnis-PDF stehen – außer er steht ausdrücklich
    // auch in behaltenen Absenderdaten (sharedWithSender, z. B. derselbe Ort wie die Krankenkasse).
    const probe = async (label) => {
      await page.evaluate(() => window.__pdfPrivacy.applyAll());
      await page.waitForFunction(() => window.__pdfPrivacy.state.result && !window.__pdfPrivacy.state.stale, null, { timeout: 60000 });
      const out = await page.evaluate(async () => {
        const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
        const doc = await pdfjs.getDocument({ data: window.__pdfPrivacy.state.result.bytes.slice() }).promise;
        let t = '';
        for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join('') + '\n';
        const rep = window.__pdfPrivacy.state.result.report;
        return { t: t.replace(/\s+/g, ''), ok: rep.ok, left: [...rep.leftInText, ...rep.leftInRaw] };
      });
      const shared = (exp.sharedWithSender || []).map(ws);
      const leaked = exp.person.filter((v) => !shared.includes(ws(v)) && out.t.includes(v.replace(/\s+/g, '')));
      if (leaked.length || !out.ok) {
        console.log(`  ✗ ${label}: NOCH ENTHALTEN ${leaked.join(' | ')} ${out.ok ? '' : `(Prüfbericht: ${out.left.join(', ')})`}`);
        sumOk -= 1;
      } else console.log(`  ✓ ${label}: keine eigenen Daten mehr im PDF`);
    };
    await probe('mit Vorschlägen der App');
    await page.evaluate(() => {
      const { state, setAction } = window.__pdfPrivacy;
      for (const f of state.findings) if ((f.owner || 'person') === 'person') setAction(f, f.fake ? 'replace' : 'redact');
    });
    await probe('alles Eigene ersetzt');
    await page.screenshot({ path: path.join(os.tmpdir(), `eval-${name}.png`) });
    if (verbose) for (const f of findings) console.log(`    ${(f.owner || '-').padEnd(7)} ${f.action.padEnd(8)} ${f.label.padEnd(22)} ${ws(f.value)}  → ${f.fake ? ws(f.fake) : ''}`);
  }
  console.log(`\nGESAMT: ${sumOk}/${sumTotal} (${Math.round((sumOk / sumTotal) * 100)} %)`);

  // -------------------------------------------------------------------------
  // Ablauf mit Schablone: Formular A bearbeiten → Schablone → Formular B automatisch
  // -------------------------------------------------------------------------
  console.log('\n=== Schablone: Kasse A bearbeiten, auf Kasse B anwenden');
  let failed = 0;
  const check = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'GKR Leistungsabrechnung' : undefined));
  const open = async (name) => {
    await page.evaluate(() => { window.__pdfPrivacy.state.file = null; });
    await page.setInputFiles('#fileInput', path.join(dir, name));
    await page.waitForFunction((n) => window.__pdfPrivacy.state.file?.name === n && window.__pdfPrivacy.state.findings.length > 0 && !window.__pdfPrivacy.state.result, name, { timeout: 30000 });
    await page.waitForTimeout(300);
  };
  const pdfText = async () => page.evaluate(async () => {
    const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: window.__pdfPrivacy.state.result.bytes.slice() }).promise;
    let t = '';
    for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
    return t;
  });
  const decide = (spec) => page.evaluate((spec) => {
    const { state, setAction } = window.__pdfPrivacy;
    for (const [match, action] of spec) {
      const f = state.findings.find((x) => x.value.includes(match) || x.label === match);
      if (!f) throw new Error('nicht gefunden: ' + match);
      setAction(f, action);
    }
  }, spec);
  const actions = () => page.evaluate(() => window.__pdfPrivacy.state.findings.map((f) => ({ label: f.label, value: f.value, owner: f.owner, action: f.action, fake: f.fake })));

  await open('kasse-a.pdf');
  await decide([['Adressblock', 'replace'], ['Versichertennummer', 'replace'], ['Kundennummer', 'redact'], ['Erika Meyer', 'redact'], ['12.01.2024', 'redact']]);
  await page.evaluate(() => window.__pdfPrivacy.applyHint('auch Physiotherapie'));
  await page.evaluate(() => window.__pdfPrivacy.viewer.setMarkMode(true));
  await page.evaluate(() => window.__pdfPrivacy.state.findings.length);
  // Bereich markieren: Unterschriftenbereich rechts unten
  await page.evaluate(() => {
    const { state } = window.__pdfPrivacy;
    const v = window.__pdfPrivacy.viewer;
    v.onDraw(0, [[350, 160], [520, 160], [520, 120], [350, 120]]);
    v.setMarkMode(false);
  });
  const a = await actions();
  await page.evaluate(() => window.__pdfPrivacy.applyAll());
  await page.waitForFunction(() => window.__pdfPrivacy.state.result);
  const textA = await pdfText();
  const blockA = a.find((f) => f.label === 'Adressblock');
  check(!/Mustermann|Musterstraße|A123456789|123456 B 7890|Physiotherapie/.test(textA), 'Kasse A: Name, Straße, Nummern, Hinweis entfernt');
  check(blockA.fake.split('\n').slice(1).every((l) => textA.includes(l)), `Kasse A: Ersatz-Adressblock im Ergebnis (${blockA.fake.replace(/\n/g, ' / ')})`);
  check(textA.includes('GKR Gesundheitskasse Rheinland') && textA.includes('Domstraße 1'), 'Kasse A: Absenderdaten bleiben stehen');
  check(await page.evaluate(() => window.__pdfPrivacy.state.result.report.ok), 'Kasse A: Prüfbericht ok');
  await page.evaluate(() => window.__pdfPrivacy.saveTemplate());
  check(await page.evaluate(() => window.__pdfPrivacy.templates.items.length === 1), 'Schablone gespeichert');
  const stored = await page.evaluate(() => localStorage.getItem('pdfprivacy.templates'));
  check(!/Mustermann|Musterstraße|A123456789|Physiotherapie|Erika/i.test(stored), 'Schablone enthält keine Dokumentinhalte');

  await open('rechnung.pdf');
  check(await page.evaluate(() => !window.__pdfPrivacy.state.templateOffer), 'Rechnung: keine Schablone angeboten (anderes Formular)');

  await open('kasse-b.pdf');
  const offer = await page.evaluate(() => window.__pdfPrivacy.state.templateOffer && { name: window.__pdfPrivacy.state.templateOffer.template.name, score: window.__pdfPrivacy.state.templateOffer.score });
  check(!!offer, `Kasse B: Schablone angeboten ${offer ? `„${offer.name}“ (${Math.round(offer.score * 100)} %)` : ''}`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'eval-offer.png') });
  await page.click('.offer .btn.primary');
  await page.waitForTimeout(500);
  const b = await actions();
  const act = (pred) => b.find(pred)?.action;
  check(act((f) => f.label === 'Adressblock') === 'replace', 'Kasse B: Adressblock → ersetzen (wie bei A)');
  check(act((f) => f.label === 'Versichertennummer') === 'replace', 'Kasse B: Versichertennummer → ersetzen');
  check(act((f) => f.label === 'Kundennummer') === 'redact', 'Kasse B: Kundennummer → schwärzen');
  check(act((f) => f.value === 'Jonas Becker') === 'redact', 'Kasse B: Ansprechpartner → schwärzen (wie bei A, obwohl Absender)');
  check(act((f) => /Physiotherapie/.test(f.value)) === 'redact', 'Kasse B: Hinweis „Physiotherapie“ übernommen');
  check(b.some((f) => f.label === 'Markierter Bereich'), 'Kasse B: markierter Bereich übernommen');
  check(act((f) => f.value === '08.02.2024') === 'redact', 'Kasse B: erstes Leistungsdatum → schwärzen (gleiche Position wie bei A)');
  await page.evaluate(() => window.__pdfPrivacy.applyAll());
  await page.waitForFunction(() => window.__pdfPrivacy.state.result);
  const textB = await pdfText();
  check(!/Anna Schmidt|Lindenallee|B987654321|654321 C 1234|Physiotherapie|Jonas Becker/.test(textB), 'Kasse B: persönliche Daten entfernt');
  check(await page.evaluate(() => window.__pdfPrivacy.state.result.report.ok), 'Kasse B: Prüfbericht ok');
  await page.evaluate(() => { window.__pdfPrivacy.state.view; document.getElementById('sheetHead').click(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(os.tmpdir(), 'eval-b-result.png') });

  // -------------------------------------------------------------------------
  // Sicherheitsrunde: Selbst wenn eine Stelle falsch zugeordnet wäre (hier künstlich: Stellen auf Seite 2
  // aus dem Fund entfernt und als Absender „behalten“), entfernt „Anwenden“ denselben Wert überall.
  // -------------------------------------------------------------------------
  console.log('\n=== Sicherheitsrunde bei falscher Zuordnung (mehrseitig.pdf)');
  await open('mehrseitig.pdf');
  await page.evaluate(() => {
    const { state } = window.__pdfPrivacy;
    for (const f of [...state.findings]) {
      if (f.value === '123456 B 7890' || f.value.includes('Schwarzmann')) {
        const moved = f.occurrences.filter((o) => o.page === 1);
        f.occurrences = f.occurrences.filter((o) => o.page === 0);
        if (moved.length) state.findings.push({ ...f, id: f.id + 'x', owner: 'sender', action: 'keep', occurrences: moved });
      }
    }
  });
  await page.evaluate(() => window.__pdfPrivacy.applyAll());
  await page.waitForFunction(() => window.__pdfPrivacy.state.result);
  const textM = await pdfText();
  check(!/123456 ?B ?7890|Schwarzmann/.test(textM), 'Kundennummer und Name auch auf Seite 2 entfernt (Sicherheitsrunde)');
  check(await page.evaluate(() => window.__pdfPrivacy.state.result.report.ok), 'Prüfbericht ok');
  // Prüfbericht mit Rest (Sicherheitsrunde für den Test abgeschaltet) → Knopf „Diese Stellen auch entfernen“
  await open('mehrseitig.pdf');
  await page.evaluate(() => {
    const { state } = window.__pdfPrivacy;
    state.testNoSweep = true;
    for (const f of [...state.findings]) {
      if (f.value !== 'A987654321') continue;
      const moved = f.occurrences.filter((o) => o.page === 1);
      f.occurrences = f.occurrences.filter((o) => o.page === 0);
      state.findings.push({ ...f, id: `${f.id}x`, owner: 'sender', action: 'keep', occurrences: moved });
    }
  });
  await page.evaluate(() => window.__pdfPrivacy.applyAll());
  await page.waitForFunction(() => window.__pdfPrivacy.state.result);
  const before = await page.evaluate(() => ({ ok: window.__pdfPrivacy.state.result.report.ok, text: document.getElementById('verify').innerText }));
  if (!(!before.ok && /A987654321/.test(before.text) && /Seite[^)]*2/.test(before.text))) console.log('    Bericht:', JSON.stringify(before));
  check(!before.ok && /A987654321/.test(before.text) && /Seite[^)]*2/.test(before.text), 'Prüfbericht nennt den Rest mit Seite');
  await page.evaluate(() => { window.__pdfPrivacy.state.testNoSweep = false; });
  await page.click('#verify .btn.primary', { force: true });
  await page.waitForFunction(() => window.__pdfPrivacy.state.result?.report.ok, null, { timeout: 60000 });
  check(!/A987654321/.test(await pdfText()), 'Nach „Diese Stellen auch entfernen“: Rest beseitigt, Prüfbericht ok');
  console.log(failed ? `  ${failed} Prüfung(en) fehlgeschlagen` : '  Alle Prüfungen bestanden');
  if (errors.length) console.log('JS-Fehler:', errors.join('; '));
  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
