// Tests der automatischen Erkennung und der Ersatzwerte. Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDocument } from '../js/detect.js';
import { PseudonymTable, Pseudonymizer, fakeIban, fakeSvnr, fakeTaxId, fakeCard, fakeDate, shapeFake } from '../js/pseudo.js';

const LETTER = `Allianz Versicherungs-AG · Königinstraße 28 · 80802 München
Herrn Max Mustermann
Musterstraße 12a
50667 Köln
Versicherungsnummer: 12 150380 M 123      Vertragsnummer: KV-4711/0815
Aktenzeichen 4 O 123/24
Sehr geehrter Herr Mustermann,
Ihre Kundennummer: 4711-0815, Ihr Ansprechpartner ist Erika Meyer, Tel. 0221 / 123 456-78
IBAN: DE89 3704 0044 0532 0130 00 BIC: COBADEFFXXX
geboren am 01.02.1980. Geburtsort: Bonn
Diagnose: Diabetes mellitus Typ 2
Steuer-ID: 12 345 678 901
Vorgang 98765432. Mustermanns Auto.`;

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), dump: () => [...m.values()].join('') };
}

const mod97 = (s) => [...s].reduce((r, d) => (r * 10 + Number(d)) % 97, 0);
const ibanValid = (iban) => {
  const c = iban.replace(/\s/g, '');
  return mod97((c.slice(4) + c.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))) === 1;
};

test('Scan findet die typischen kritischen Daten mit echtem Wert und Bewertung', () => {
  const f = scanDocument([LETTER]);
  const get = (v) => f.find((x) => x.value === v);
  const expect = {
    '12 150380 M 123': 'hoch', 'DE89 3704 0044 0532 0130 00': 'hoch', '01.02.1980': 'hoch', 'Diabetes mellitus Typ 2': 'hoch',
    '12 345 678 901': 'hoch', 'Max Mustermann': 'mittel', 'Erika Meyer': 'mittel', 'KV-4711/0815': 'mittel',
    '4 O 123/24': 'mittel', '4711-0815': 'mittel', '0221 / 123 456-78': 'mittel', 'Musterstraße 12a': 'mittel',
    '50667 Köln': 'mittel', 'COBADEFFXXX': 'mittel', 'Bonn': 'mittel', '98765432': 'niedrig',
  };
  for (const [v, risk] of Object.entries(expect)) {
    assert.ok(get(v), `nicht gefunden: ${v}`);
    assert.equal(get(v).risk, risk, v);
  }
  assert.equal(get('KV-4711/0815').label, 'Vertragsnummer');
  assert.equal(get('Diabetes mellitus Typ 2').label, 'Diagnose');
});

test('Gleiche Person wird zusammengefasst (Vor-/Nachname, Genitiv)', () => {
  const f = scanDocument([LETTER]).find((x) => x.value === 'Max Mustermann');
  assert.equal(f.occurrences.length, 3);
  assert.deepEqual(f.variants.sort(), ['Mustermann', 'Mustermanns']);
});

test('Hohe Risiken stehen in der Liste oben', () => {
  const risks = scanDocument([LETTER]).map((f) => f.risk);
  const order = { hoch: 0, mittel: 1, niedrig: 2 };
  assert.deepEqual(risks, [...risks].sort((a, b) => order[a] - order[b]));
});

test('Ersatzwerte behalten die Struktur und haben gültige Prüfziffern', () => {
  for (let i = 0; i < 50; i++) {
    const iban = fakeIban('DE89 3704 0044 0532 0130 00');
    assert.match(iban, /^DE\d{2} \d{4} \d{4} \d{4} \d{4} \d{2}$/);
    assert.ok(ibanValid(iban), iban);
    assert.match(fakeSvnr('12 150380 M 123'), /^12 \d{6} [A-Z] \d{3}$/);
    assert.match(fakeTaxId('12 345 678 901'), /^[1-9]\d \d{3} \d{3} \d{3}$/);
    assert.match(shapeFake('KV-4711/0815'), /^[A-Z]{2}-\d{4}\/\d{4}$/);
    assert.match(fakeDate('01.02.1980'), /^\d{2}\.\d{2}\.\d{4}$/);
    const card = fakeCard('4111 1111 1111 1111').replace(/\s/g, '');
    let sum = 0;
    [...card].reverse().forEach((d, k) => { let n = +d; if (k % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; });
    assert.equal(sum % 10, 0);
  }
});

test('Pseudonym-Tabelle: gleicher Wert → gleicher Ersatz, Originale nicht im Klartext', async () => {
  const storage = memoryStorage();
  const fs1 = scanDocument([LETTER]);
  const p1 = new Pseudonymizer(new PseudonymTable(storage));
  for (const f of fs1) { await p1.prepare(f); f.action = 'replace'; }
  await p1.commit(fs1);
  const raw = storage.dump();
  for (const secret of ['Mustermann', '3704', '150380', 'COBADEFF', '4711-0815']) assert.ok(!raw.includes(secret), secret);

  const p2 = new Pseudonymizer(new PseudonymTable(storage));
  const fs2 = scanDocument([LETTER.replace('Herrn Max Mustermann', 'Herrn Max  Mustermann')]);
  for (const f of fs2) await p2.prepare(f);
  for (const cat of ['iban', 'svnr', 'names', 'idnumber']) {
    const a = fs1.find((f) => f.cat === cat), b = fs2.find((f) => f.cat === cat && f.value.replace(/\s+/g, ' ') === a.value);
    assert.ok(b?.known, `${cat} nicht wiedererkannt`);
    assert.equal(b.fake, a.fake, cat);
  }
});

test('Namen werden pro Bestandteil ersetzt (Genitiv, E-Mail)', async () => {
  const p = new Pseudonymizer(new PseudonymTable(memoryStorage()));
  const fs = scanDocument(['Herrn Max Mustermann\nMustermanns Auto\nE-Mail: max.mustermann@firma-xy.de']);
  for (const f of fs) await p.prepare(f);
  const name = fs.find((f) => f.cat === 'names');
  const last = name.fake.split(' ').pop();
  assert.equal(p.fakeFor(name, 'Mustermanns'), `${last}s`);
  const mail = fs.find((f) => f.cat === 'email');
  const ascii = (t) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  assert.ok(mail.fake.startsWith(`${ascii(name.fake.split(' ')[0])}.${ascii(last)}@`), mail.fake);
  assert.ok(!mail.fake.includes('firma-xy'), 'Firmen-Domain wird ersetzt');
});
