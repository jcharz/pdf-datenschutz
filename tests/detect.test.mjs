// Tests der lokalen Befehlserkennung und Treffersuche. Aufruf: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, findMatches, koelner } from '../js/detect.js';

const PAGE = `Sehr geehrter Herr Max Mustermann,
Ihre Kundennummer: 4711-0815
E-Mail: max.mustermann@example.de, Tel. 0221 / 123 456-78
IBAN: DE89 3704 0044 0532 0130 00 BIC: COBADEFFXXX
Musterstraße 12a
50667 Köln
geboren am 01.02.1980. Rechnungs-Nr. 2024-001 Betrag: 1.234,56 €
Mit freundlichen Grüßen
Erika Meyer`;

const hits = (cmd, pages = [PAGE]) =>
  parseCommand(cmd).rules.map((r) => findMatches(r, pages).map((m) => m.text));

test('Kategorien per Sprache', () => {
  assert.deepEqual(hits('Entferne alle E-Mail-Adressen und Telefonnummern.'), [
    ['max.mustermann@example.de'],
    ['0221 / 123 456-78'],
  ]);
  assert.deepEqual(hits('Lösche die IBAN und die BIC'), [['DE89 3704 0044 0532 0130 00'], ['COBADEFFXXX']]);
  assert.deepEqual(hits('die Adresse'), [['Musterstraße 12a', '50667 Köln']]);
  assert.deepEqual(hits('Geldbeträge und das Geburtsdatum'), [['1.234,56 €'], ['01.02.1980']]);
});

test('„E-Mail Adressen“ (Leerzeichen) ist keine Postadresse', () => {
  const r = parseCommand('E-Mail Adressen entfernen').rules;
  assert.deepEqual(r.map((x) => x.cat), ['email']);
});

test('Namen inkl. Teilen, Genitiv und E-Mail-Bestandteil', () => {
  const [m] = hits('Schwärze den Namen Max Mustermann', [PAGE + '\nMustermanns Auto']);
  assert.ok(m.includes('Max Mustermann'));
  assert.ok(m.includes('Mustermanns'));
});

test('Ähnliche Schreibweise aus der Spracherkennung', () => {
  const [m] = hits('Entferne Erika Maier');
  assert.deepEqual(m, ['Erika Meyer']);
  assert.equal(koelner('Meyer'), koelner('Maier'));
});

test('Wert hinter einer Bezeichnung', () => {
  assert.deepEqual(hits('Entferne die Kundennummer'), [['4711-0815']]);
  assert.deepEqual(hits('Rechnungsnummer entfernen'), [['2024-001']]);
});

test('Personennamen ohne Vorgabe (Anrede, Grußformel)', () => {
  const [m] = hits('entferne alle Namen');
  assert.ok(m.includes('Max Mustermann'));
  assert.ok(m.includes('Erika Meyer'));
});

test('Telefonnummer-Erkennung schneidet keine IBAN an', () => {
  const [m] = hits('Telefonnummern');
  assert.deepEqual(m, ['0221 / 123 456-78']);
});

test('Seitenangabe', () => {
  const pages = ['Geheim A', 'Geheim B', 'Geheim C'];
  const r = parseCommand('Entferne das Wort Geheim auf Seite 2').rules[0];
  assert.deepEqual(findMatches(r, pages).map((m) => m.page), [1]);
  const last = parseCommand('Entferne das Wort Geheim auf der letzten Seite').rules[0];
  assert.deepEqual(findMatches(last, pages).map((m) => m.page), [2]);
});

test('Anführungszeichen schützen Begriffe', () => {
  const r = parseCommand('Entferne „Müller und Söhne“').rules;
  assert.equal(r.length, 1);
  assert.equal(r[0].term, 'Müller und Söhne');
});

test('Steuerbefehle', () => {
  assert.equal(parseCommand('Anwenden').action, 'apply');
  assert.equal(parseCommand('schwärzen').action, 'apply');
  assert.equal(parseCommand('Rückgängig').action, 'undo');
  assert.equal(parseCommand('Alles zurücksetzen').action, 'reset');
  assert.equal(parseCommand('Speichern').action, 'save');
  const s = parseCommand('Speichern unter Vertrag anonym');
  assert.equal(s.action, 'save');
  assert.equal(s.saveName, 'Vertrag anonym');
});

test('Alle personenbezogenen Daten', () => {
  const cats = parseCommand('Entferne alle personenbezogenen Daten').rules.map((r) => r.cat);
  for (const c of ['email', 'phone', 'iban', 'address', 'names']) assert.ok(cats.includes(c), c);
});

test('Keine Fehltreffer bei Datum/Postleitzahl als Telefonnummer', () => {
  const [m] = hits('Telefonnummern', ['am 01.02.2024 in 01067 Dresden']);
  assert.deepEqual(m, []);
});
