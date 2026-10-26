// Erzeugt realistische Beispieldokumente (alle Daten erfunden) samt Erwartungen für die Auswertung.
// Aufruf: node tests/samples.cjs [Zielordner]   – Standard: tests/samples/

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdf-lib/pdf-lib.min.js');

const A4 = [595, 842];

async function makeDoc(build) {
  const doc = await PDFDocument.create();
  const fonts = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  let page;
  const api = {
    page() { page = doc.addPage(A4); return page; },
    // y = Abstand von oben
    t(x, y, str, size = 10, bold = false, color = rgb(0, 0, 0)) {
      page.drawText(str, { x, y: A4[1] - y, size, font: bold ? fonts.b : fonts.r, color });
    },
    line(x1, y, x2) { page.drawLine({ start: { x: x1, y: A4[1] - y }, end: { x: x2, y: A4[1] - y }, thickness: 0.5 }); },
    doc,
  };
  await build(api);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ---------------------------------------------------------------------------
// 1 + 2: Leistungsabrechnung einer Krankenkasse (gleiches Formular, zwei Personen)
// ---------------------------------------------------------------------------

function kasse(p) {
  return async ({ page, t, line }) => {
    page();
    // Briefkopf rechts oben
    t(380, 50, 'GKR Gesundheitskasse Rheinland', 11, true);
    t(380, 64, 'Die Krankenkasse für das Rheinland', 8);
    // Absenderzeile im Adressfenster
    t(60, 128, 'GKR Gesundheitskasse Rheinland · Postfach 10 20 30 · 50450 Köln', 7);
    line(60, 131, 300);
    // Empfänger links und Infoblock rechts – zeilenweise abwechselnd gezeichnet (wie bei vielen Formularprogrammen)
    const left = [p.anrede, p.name, p.strasse, p.ort];
    const right = [
      `Ihr Ansprechpartner: ${p.sb}`,
      `Telefon: 0221 2345-${p.durchwahl}`,
      'E-Mail: service@gkr-beispiel.de',
      `Versichertennummer: ${p.vnr}`,
      `Kundennummer: ${p.kdnr}`,
      `Datum: ${p.datum}`,
    ];
    for (let i = 0; i < 6; i++) {
      if (left[i]) t(60, 150 + i * 14, left[i], 10);
      t(360, 150 + i * 14, right[i], 9);
    }
    t(60, 260, `Leistungsabrechnung ${p.jahr}`, 14, true);
    t(60, 290, `Sehr geehrte${p.anrede === 'Frau' ? ' Frau' : 'r Herr'} ${p.nach},`, 10);
    t(60, 306, 'wir haben die folgenden Leistungen für Sie abgerechnet:', 10);
    t(60, 330, 'Datum', 9, true); t(140, 330, 'Leistung', 9, true); t(470, 330, 'Betrag', 9, true);
    line(60, 334, 535);
    p.rows.forEach((r, i) => {
      t(60, 348 + i * 14, r[0], 9); t(140, 348 + i * 14, r[1], 9); t(470, 348 + i * 14, r[2], 9);
    });
    const y = 348 + p.rows.length * 14 + 20;
    t(60, y, `Diagnose: ${p.diagnose}`, 10);
    t(60, y + 16, `Der Erstattungsbetrag wird auf Ihr Konto IBAN ${p.iban} überwiesen.`, 10);
    t(60, y + 50, 'Mit freundlichen Grüßen', 10);
    t(60, y + 64, 'Ihre GKR Gesundheitskasse Rheinland', 10);
    t(60, y + 92, p.sb, 10);
    // Fußzeile
    t(60, 790, 'GKR Gesundheitskasse Rheinland · Hauptverwaltung · Domstraße 1 · 50667 Köln · Telefon 0221 9999-0 · www.gkr-beispiel.de', 6.5);
    t(60, 800, 'Bankverbindung: Sparkasse KölnBonn · IBAN DE38 3705 0198 0012 3456 00 · BIC COLSDE33XXX · USt-IdNr. DE123456789', 6.5);
  };
}

const KASSE_A = {
  anrede: 'Herrn', name: 'Max Mustermann', nach: 'Mustermann', strasse: 'Musterstraße 12a', ort: '50667 Köln',
  sb: 'Erika Meyer', durchwahl: '678', vnr: 'A123456789', kdnr: '123456 B 7890', datum: '03.05.2024', jahr: '2024',
  diagnose: 'J45.0 Asthma bronchiale', iban: 'DE89 3704 0044 0532 0130 00',
  rows: [['12.01.2024', 'Krankenhausbehandlung', '1.234,56 €'], ['03.02.2024', 'Physiotherapie', '245,00 €'], ['17.03.2024', 'Arzneimittel', '38,90 €']],
};
const KASSE_B = {
  anrede: 'Frau', name: 'Anna Schmidt', nach: 'Schmidt', strasse: 'Lindenallee 7', ort: '51063 Köln',
  sb: 'Jonas Becker', durchwahl: '512', vnr: 'B987654321', kdnr: '654321 C 1234', datum: '14.06.2024', jahr: '2024',
  diagnose: 'M54.5 Kreuzschmerz', iban: 'DE02 1203 0000 0000 2020 51',
  rows: [['08.02.2024', 'Physiotherapie', '312,40 €'], ['19.04.2024', 'Hilfsmittel', '89,00 €']],
};

// Erwartungen: Wert → wem er gehört. block = Teil eines Adress-/Absenderblocks.
const expectKasse = (p) => ({
  person: [p.name, p.strasse, p.ort, p.nach, p.vnr, p.kdnr, p.iban, p.diagnose],
  sender: ['Postfach 10 20 30', '50450 Köln', p.sb, `0221 2345-${p.durchwahl}`, 'service@gkr-beispiel.de', 'Domstraße 1',
    'DE38 3705 0198 0012 3456 00', 'COLSDE33XXX', 'DE123456789', '0221 9999-0'],
  blocks: [{ owner: 'person', contains: [p.name, p.strasse, p.ort] }],
  exact: { [p.kdnr]: 'Kundennummer', [p.vnr]: 'Versichertennummer' },
  notPerson: ['Leistungsabrechnung', 'Krankenhausbehandlung', 'Physiotherapie', 'Gesundheitskasse'],
  // steht auch in der (behaltenen) Fußzeile der Krankenkasse: „Domstraße 1 · 50667 Köln“
  sharedWithSender: p.ort === '50667 Köln' ? ['50667 Köln'] : [],
});

// ---------------------------------------------------------------------------
// 3: Handwerkerrechnung
// ---------------------------------------------------------------------------

const rechnung = async ({ page, t, line }) => {
  page();
  t(60, 50, 'Elektro Hoffmann GmbH', 16, true);
  t(60, 68, 'Meisterbetrieb seit 1987', 9);
  t(400, 50, 'Industriestraße 14', 9);
  t(400, 62, '42103 Wuppertal', 9);
  t(400, 74, 'Tel. 0202 445566', 9);
  t(400, 86, 'info@elektro-hoffmann-beispiel.de', 9);
  t(60, 128, 'Elektro Hoffmann GmbH, Industriestraße 14, 42103 Wuppertal', 7);
  t(60, 150, 'Familie', 10);
  t(60, 164, 'Claudia und Peter Wagner', 10);
  t(60, 178, 'Am Mühlbach 3', 10);
  t(60, 192, '42651 Solingen', 10);
  t(60, 250, 'Rechnung', 16, true);
  t(60, 272, 'Rechnungsnummer: RE-2024-0815', 10);
  t(60, 286, 'Kundennummer: KD-2024 / 0815', 10);
  t(60, 300, 'Rechnungsdatum: 22.07.2024', 10);
  t(60, 314, 'Leistungsort: Am Mühlbach 3, 42651 Solingen', 10);
  t(60, 344, 'Pos.', 9, true); t(100, 344, 'Beschreibung', 9, true); t(470, 344, 'Betrag', 9, true);
  line(60, 348, 535);
  t(60, 362, '1', 9); t(100, 362, 'Austausch Sicherungskasten inkl. Material', 9); t(470, 362, '1.480,00 €', 9);
  t(60, 376, '2', 9); t(100, 376, 'Arbeitszeit 6 Std. à 58,00 €', 9); t(470, 376, '348,00 €', 9);
  t(60, 400, 'Gesamtbetrag inkl. 19 % MwSt.: 2.175,32 €', 10, true);
  t(60, 430, 'Bitte überweisen Sie den Betrag innerhalb von 14 Tagen.', 10);
  t(60, 470, 'Mit freundlichen Grüßen', 10);
  t(60, 498, 'Thomas Hoffmann', 10);
  t(60, 790, 'Elektro Hoffmann GmbH · Geschäftsführer: Thomas Hoffmann · Amtsgericht Wuppertal HRB 12345 · Steuernummer 132/5730/1234', 6.5);
  t(60, 800, 'Stadtsparkasse Wuppertal · IBAN DE10 3305 0000 0000 9876 54 · BIC WUPSDE33XXX', 6.5);
};
const expectRechnung = {
  person: ['Claudia und Peter Wagner', 'Am Mühlbach 3', '42651 Solingen', 'KD-2024 / 0815', 'RE-2024-0815'],
  sender: ['Industriestraße 14', '42103 Wuppertal', '0202 445566', 'info@elektro-hoffmann-beispiel.de', 'Thomas Hoffmann',
    'HRB 12345', '132/5730/1234', 'DE10 3305 0000 0000 9876 54'],
  blocks: [{ owner: 'person', contains: ['Claudia und Peter Wagner', 'Am Mühlbach 3', '42651 Solingen'] },
    { owner: 'sender', contains: ['Industriestraße 14', '42103 Wuppertal'] }],
  exact: { 'KD-2024 / 0815': 'Kundennummer' },
  notPerson: ['Sicherungskasten', 'Rechnung', 'Gesamtbetrag'],
};

// ---------------------------------------------------------------------------
// 4: Arztbrief
// ---------------------------------------------------------------------------

const arztbrief = async ({ page, t }) => {
  page();
  t(60, 50, 'Praxis Dr. med. Thomas Weber', 13, true);
  t(60, 66, 'Facharzt für Innere Medizin · Hauptstraße 5 · 53111 Bonn · Tel. 0228 123456', 8);
  t(60, 130, 'Praxis Dr. Weber · Hauptstraße 5 · 53111 Bonn', 7);
  t(60, 150, 'Frau Dr. med. Sabine Kraus', 10);
  t(60, 164, 'Fachärztin für Kardiologie', 10);
  t(60, 178, 'Kaiserstraße 20', 10);
  t(60, 192, '53113 Bonn', 10);
  t(400, 150, 'Bonn, 02.09.2024', 10);
  t(60, 240, 'Arztbrief', 14, true);
  t(60, 262, 'Patientin: Lisa Müller, geb. 12.03.1985', 10);
  t(60, 276, 'Anschrift: Rosenweg 8, 53119 Bonn', 10);
  t(60, 290, 'Krankenkasse: GKR Gesundheitskasse Rheinland, Versichertennummer: L198503121', 10);
  t(60, 316, 'Diagnosen:', 10, true);
  t(60, 330, 'I10.90 Essentielle Hypertonie', 10);
  t(60, 344, 'E78.0 Hypercholesterinämie', 10);
  t(60, 370, 'Medikation: Ramipril 5 mg 1-0-0, Atorvastatin 20 mg 0-0-1', 10);
  t(60, 396, 'Sehr geehrte Frau Kollegin Kraus,', 10);
  t(60, 410, 'ich berichte über unsere gemeinsame Patientin Frau Müller, die sich am 28.08.2024 vorstellte.', 10);
  t(60, 450, 'Mit freundlichen kollegialen Grüßen', 10);
  t(60, 478, 'Dr. med. Thomas Weber', 10);
};
const expectArzt = {
  person: ['Lisa Müller', '12.03.1985', 'Rosenweg 8', '53119 Bonn', 'L198503121', 'Essentielle Hypertonie', 'Hypercholesterinämie', 'Ramipril'],
  sender: ['Hauptstraße 5', '0228 123456', 'Thomas Weber'],
  blocks: [],
  exact: { L198503121: 'Versichertennummer' },
  notPerson: ['Arztbrief', 'Innere Medizin'],
};

// ---------------------------------------------------------------------------
// 5: Formular mit Beschriftung über dem Wert (Tabellen-/Kastenlayout)
// ---------------------------------------------------------------------------

const formular = async ({ page, t, line }) => {
  page();
  t(60, 50, 'Antrag auf Kostenübernahme', 14, true);
  t(60, 70, 'Bundesagentur für Beispielwesen · Zentrale Antragsstelle', 8);
  const box = (x, y, label, value) => { t(x, y, label, 7); t(x, y + 13, value, 10); line(x, y + 17, x + 220); };
  box(60, 110, 'Name, Vorname', 'Weber, Jonas');
  box(300, 110, 'Geburtsdatum', '24.11.1990');
  box(60, 145, 'Straße, Hausnummer', 'Birkenweg 17');
  box(300, 145, 'PLZ, Ort', '80331 München');
  box(60, 180, 'Versicherungsnummer', '65 241190 W 012');
  box(300, 180, 'Steuer-Identifikationsnummer', '47 036 892 816');
  box(60, 215, 'Telefon', '0171 2345678');
  box(300, 215, 'E-Mail', 'jonas.weber@mail-beispiel.de');
  box(60, 250, 'Kontoinhaber', 'Jonas Weber');
  box(300, 250, 'IBAN', 'DE75 5121 0800 1245 1261 99');
  t(60, 300, 'Ich bestätige die Richtigkeit meiner Angaben.', 10);
  t(60, 330, 'München, 01.10.2024', 10);
};
const expectFormular = {
  person: ['Weber, Jonas', '24.11.1990', 'Birkenweg 17', '80331 München', '65 241190 W 012', '47 036 892 816', '0171 2345678',
    'jonas.weber@mail-beispiel.de', 'Jonas Weber', 'DE75 5121 0800 1245 1261 99'],
  sender: [],
  blocks: [],
  exact: {},
  notPerson: ['Kostenübernahme', 'Richtigkeit'],
};

// ---------------------------------------------------------------------------
// 6: Kontoauszug
// ---------------------------------------------------------------------------

const konto = async ({ page, t, line }) => {
  page();
  t(60, 50, 'Stadtsparkasse Musterstadt', 14, true);
  t(60, 66, 'Am Markt 1 · 60311 Frankfurt am Main', 8);
  t(60, 110, 'Kontoauszug Nr. 7/2024', 13, true);
  t(60, 132, 'Kontoinhaber: Laura Becker', 10);
  t(60, 146, 'IBAN: DE44 5001 0517 5407 3249 31', 10);
  t(330, 132, 'Auszugsdatum: 31.07.2024', 10);
  t(330, 146, 'Kundennummer: 0049 1123 77', 10);
  t(60, 180, 'Buchung', 9, true); t(120, 180, 'Vorgang', 9, true); t(470, 180, 'Betrag', 9, true);
  line(60, 184, 535);
  const rows = [
    ['01.07.', 'Gehalt Juli Muster Software GmbH', '3.215,40'],
    ['03.07.', 'Überweisung an Erika Wagner Miete Juli', '-980,00'],
    ['05.07.', 'Lastschrift Stadtwerke Musterstadt Kd-Nr 448812', '-64,20'],
    ['12.07.', 'Kartenzahlung REWE Markt', '-87,13'],
  ];
  rows.forEach((r, i) => { t(60, 198 + i * 14, r[0], 9); t(120, 198 + i * 14, r[1], 9); t(470, 198 + i * 14, r[2], 9); });
  t(60, 270, 'Neuer Kontostand: 4.512,77 EUR', 10, true);
  t(60, 790, 'Stadtsparkasse Musterstadt · Anstalt des öffentlichen Rechts · BIC HELADEF1MUS · www.sparkasse-beispiel.de', 6.5);
};
const expectKonto = {
  person: ['Laura Becker', 'DE44 5001 0517 5407 3249 31', '0049 1123 77', 'Erika Wagner'],
  sender: ['Am Markt 1', 'HELADEF1MUS'],
  blocks: [],
  exact: { '0049 1123 77': 'Kundennummer' },
  notPerson: ['Kontoauszug', 'Kartenzahlung', 'Stadtwerke'],
};

// ---------------------------------------------------------------------------
// 7: Bescheid vom Finanzamt (Absender links oben als Block, Empfänger im Fenster)
// ---------------------------------------------------------------------------

const finanzamt = async ({ page, t }) => {
  page();
  t(60, 40, 'Finanzamt Musterstadt', 12, true);
  t(60, 54, 'Steuerstraße 10', 9);
  t(60, 66, '60329 Frankfurt am Main', 9);
  t(60, 78, 'Telefon 069 1234-0', 9);
  t(60, 125, 'Finanzamt Musterstadt, Postfach 11 22 33, 60001 Frankfurt', 7);
  t(60, 145, 'Herrn und Frau', 10);
  t(60, 159, 'Stefan und Julia Neumann', 10);
  t(60, 173, 'Gartenweg 4', 10);
  t(60, 187, '61440 Oberursel', 10);
  t(380, 145, 'Steuernummer: 045 812 34567', 9);
  t(380, 159, 'Bearbeiter: Herr Schulz', 9);
  t(380, 173, 'Durchwahl: 069 1234-412', 9);
  t(60, 240, 'Bescheid für 2023 über Einkommensteuer', 13, true);
  t(60, 262, 'Steuer-ID Ehemann: 86 095 742 719 · Steuer-ID Ehefrau: 57 549 285 017', 10);
  t(60, 290, 'Festgesetzt werden: Einkommensteuer 4.812,00 €, Solidaritätszuschlag 0,00 €', 10);
  t(60, 310, 'Der Erstattungsbetrag von 1.106,00 € wird auf das Konto DE89 3704 0044 0532 0130 00 überwiesen.', 10);
  t(60, 790, 'Öffnungszeiten: Mo–Fr 8–12 Uhr · Bundesbank Filiale Frankfurt · IBAN DE81 5000 0000 0050 0015 08', 6.5);
};
const expectFinanzamt = {
  person: ['Stefan und Julia Neumann', 'Gartenweg 4', '61440 Oberursel', '045 812 34567', '86 095 742 719', '57 549 285 017', 'DE89 3704 0044 0532 0130 00'],
  sender: ['Steuerstraße 10', '60329 Frankfurt am Main', '069 1234-0', 'Postfach 11 22 33', 'Schulz', '069 1234-412', 'DE81 5000 0000 0050 0015 08'],
  blocks: [{ owner: 'person', contains: ['Stefan und Julia Neumann', 'Gartenweg 4', '61440 Oberursel'] },
    { owner: 'sender', contains: ['Steuerstraße 10', '60329 Frankfurt am Main'] }],
  exact: { '045 812 34567': 'Steuernummer' },
  notPerson: ['Einkommensteuer', 'Solidaritätszuschlag', 'Bescheid'],
};

// ---------------------------------------------------------------------------
// 8: Privatbrief ohne Anrede-Zeile, Datum rechts in derselben Höhe
// ---------------------------------------------------------------------------

const privatbrief = async ({ page, t }) => {
  page();
  t(60, 60, 'Markus Schreiber', 11);
  t(400, 60, 'Leipzig, 4. März 2024', 11);
  t(60, 75, 'Lindenstraße 23', 11);
  t(60, 90, '04109 Leipzig', 11);
  t(60, 105, 'markus.schreiber@posteo.de', 11);
  t(60, 150, 'Hausverwaltung Krause & Partner', 11);
  t(60, 165, 'Herrn Dieter Krause', 11);
  t(60, 180, 'Brühl 52', 11);
  t(60, 195, '04109 Leipzig', 11);
  t(60, 240, 'Kündigung meiner Wohnung, Mietvertragsnummer MV-2019-0442', 11, true);
  t(60, 265, 'Sehr geehrter Herr Krause,', 11);
  t(60, 285, 'hiermit kündige ich die Wohnung im 2. OG fristgerecht zum 30.06.2024.', 11);
  t(60, 300, 'Bitte überweisen Sie die Kaution auf mein Konto DE02 1203 0000 0000 2020 51.', 11);
  t(60, 330, 'Mit freundlichen Grüßen', 11);
  t(60, 360, 'Markus Schreiber', 11);
};
const expectPrivat = {
  person: ['Markus Schreiber', 'Lindenstraße 23', 'markus.schreiber@posteo.de', 'MV-2019-0442', 'DE02 1203 0000 0000 2020 51'],
  sender: [],
  blocks: [{ owner: 'person', contains: ['Markus Schreiber', 'Lindenstraße 23', '04109 Leipzig'] }],
  exact: { 'MV-2019-0442': 'Mietvertragsnummer' },
  notPerson: ['Kündigung', 'Wohnung'],
};

// ---------------------------------------------------------------------------
// 9: Vertrag mit Namen und Adressen im Fließtext
// ---------------------------------------------------------------------------

const vertrag = async ({ page, t }) => {
  page();
  t(60, 60, 'Arbeitsvertrag', 16, true);
  t(60, 95, 'Zwischen der Muster Software GmbH, Hafenstraße 8, 20457 Hamburg,', 10);
  t(60, 109, 'vertreten durch den Geschäftsführer Herrn Klaus Fischer (nachfolgend „Arbeitgeber“),', 10);
  t(60, 123, 'und Frau Laura Becker, geboren am 14.09.1994, wohnhaft Am Rosengarten 5, 79098 Freiburg', 10);
  t(60, 137, '(nachfolgend „Arbeitnehmerin“) wird folgender Vertrag geschlossen:', 10);
  t(60, 165, '§ 1 Beginn: Das Arbeitsverhältnis beginnt am 01.10.2024.', 10);
  t(60, 181, '§ 2 Vergütung: Die Arbeitnehmerin erhält ein Bruttogehalt von 4.250,00 € monatlich.', 10);
  t(60, 197, 'Sozialversicherungsnummer: 15 140994 B 506, Steuer-ID: 37 948 162 503', 10);
  t(60, 213, 'Krankenkasse: Techniker Krankenkasse', 10);
  t(60, 260, 'Hamburg, 15.08.2024', 10);
  t(60, 300, 'Klaus Fischer', 10); t(320, 300, 'Laura Becker', 10);
};
const expectVertrag = {
  person: ['Laura Becker', '14.09.1994', 'Am Rosengarten 5', '79098 Freiburg', '15 140994 B 506', '37 948 162 503'],
  sender: ['Hafenstraße 8', 'Klaus Fischer'],
  blocks: [],
  exact: {},
  notPerson: ['Arbeitsvertrag', 'Arbeitnehmerin', 'Vergütung'],
};

// ---------------------------------------------------------------------------
// 10: Zweiseitiger Brief mit wiederholtem Briefkopf/Fußzeile
// ---------------------------------------------------------------------------

const zweiseitig = async ({ page, t }) => {
  for (let p = 1; p <= 2; p++) {
    page();
    t(380, 45, 'Kanzlei Berger & Lang', 11, true);
    t(380, 58, 'Rechtsanwälte', 8);
    t(60, 790, 'Kanzlei Berger & Lang · Königsallee 60 · 40212 Düsseldorf · Tel. 0211 556677 · kanzlei@berger-lang-beispiel.de', 6.5);
    t(500, 805, `Seite ${p}`, 7);
    if (p === 1) {
      t(60, 128, 'Kanzlei Berger & Lang · Königsallee 60 · 40212 Düsseldorf', 7);
      t(60, 148, 'Frau', 10);
      t(60, 162, 'Sabine Hoffmann', 10);
      t(60, 176, 'Rheinuferstraße 3', 10);
      t(60, 190, '40213 Düsseldorf', 10);
      t(380, 148, 'Unser Zeichen: 2024/117-BL', 9);
      t(380, 162, 'Ihr Zeichen: SH-0815', 9);
      t(60, 240, 'Ihre Angelegenheit gegen Nachbar Ralf Kühn', 12, true);
      t(60, 265, 'Sehr geehrte Frau Hoffmann,', 10);
      t(60, 281, 'in der oben genannten Sache teilen wir Ihnen mit, dass Herr Kühn die Forderung bestreitet.', 10);
    } else {
      t(60, 100, 'Frau Hoffmann sollte bis zum 15.11.2024 die Unterlagen einreichen.', 10);
      t(60, 130, 'Mit freundlichen Grüßen', 10);
      t(60, 160, 'Dr. Martin Berger', 10);
      t(60, 172, 'Rechtsanwalt', 10);
    }
  }
};
const expectZweiseitig = {
  person: ['Sabine Hoffmann', 'Rheinuferstraße 3', '40213 Düsseldorf', 'SH-0815', 'Ralf Kühn', 'Kühn'],
  sender: ['Königsallee 60', '0211 556677', 'kanzlei@berger-lang-beispiel.de', 'Martin Berger', '2024/117-BL'],
  blocks: [{ owner: 'person', contains: ['Sabine Hoffmann', 'Rheinuferstraße 3', '40213 Düsseldorf'] }],
  exact: { 'SH-0815': 'Ihr Zeichen' },
  notPerson: ['Angelegenheit', 'Forderung', 'Unterlagen'],
};

// ---------------------------------------------------------------------------
// 11: Mehrseitig – eigene Nummer und Name auf Seite 2 in Kopf- und Fußzeile wiederholt
// ---------------------------------------------------------------------------

const mehrseitig = async ({ page, t, line }) => {
  page();
  t(380, 50, 'GKR Gesundheitskasse Rheinland', 11, true);
  t(60, 128, 'GKR Gesundheitskasse Rheinland · Postfach 10 20 30 · 50450 Köln', 7);
  line(60, 131, 300);
  t(60, 150, 'Herrn', 10); t(60, 164, 'Jochen Schwarzmann', 10); t(60, 178, 'Birkenallee 14', 10); t(60, 192, '50939 Köln', 10);
  t(360, 150, 'Kundennummer: 123456 B 7890', 9);
  t(360, 164, 'Versichertennummer: A987654321', 9);
  t(360, 178, 'Datum: 02.10.2024', 9);
  t(60, 250, 'Leistungsübersicht 2024', 14, true);
  t(60, 280, 'Sehr geehrter Herr Schwarzmann,', 10);
  t(60, 296, 'anbei die Übersicht Ihrer Leistungen. Details finden Sie auf Seite 2.', 10);
  t(60, 790, 'GKR Gesundheitskasse Rheinland · Domstraße 1 · 50667 Köln · www.gkr-beispiel.de · Seite 1 von 2', 6.5);
  page();
  // Kopfzeile Seite 2: Name und Versichertennummer klein oben
  t(60, 40, 'GKR Leistungsübersicht 2024 für Jochen Schwarzmann · Versichertennummer A987654321', 7.5);
  line(60, 44, 535);
  t(60, 90, 'Datum', 9, true); t(140, 90, 'Leistung', 9, true); t(470, 90, 'Betrag', 9, true);
  t(60, 104, '05.03.2024', 9); t(140, 104, 'Zahnersatz', 9); t(470, 104, '612,00 €', 9);
  t(60, 140, 'Bitte geben Sie bei Rückfragen Ihre Kundennummer 123456 B 7890 an.', 10);
  t(60, 170, 'Mit freundlichen Grüßen', 10);
  t(60, 184, 'Ihre GKR Gesundheitskasse Rheinland', 10);
  // Fußzeile Seite 2 mit der Kundennummer
  t(60, 790, 'GKR Gesundheitskasse Rheinland · Kundennummer 123456 B 7890 · Jochen Schwarzmann · Seite 2 von 2', 6.5);
};
const expectMehrseitig = {
  person: ['Jochen Schwarzmann', 'Birkenallee 14', '50939 Köln', '123456 B 7890', 'A987654321', 'Schwarzmann'],
  sender: ['Postfach 10 20 30', 'Domstraße 1'],
  blocks: [{ owner: 'person', contains: ['Jochen Schwarzmann', 'Birkenallee 14', '50939 Köln'] }],
  exact: { '123456 B 7890': 'Kundennummer' },
  // Jede Stelle dieser Werte muss als „eigene Daten“ gelten – auch in Kopf- und Fußzeile von Seite 2
  everywherePerson: ['123456 B 7890', 'A987654321', 'Jochen Schwarzmann'],
  notPerson: ['Leistungsübersicht', 'Zahnersatz'],
};

const SAMPLES = [
  ['kasse-a.pdf', kasse(KASSE_A), expectKasse(KASSE_A)],
  ['kasse-b.pdf', kasse(KASSE_B), expectKasse(KASSE_B)],
  ['rechnung.pdf', rechnung, expectRechnung],
  ['arztbrief.pdf', arztbrief, expectArzt],
  ['formular.pdf', formular, expectFormular],
  ['kontoauszug.pdf', konto, expectKonto],
  ['finanzamt.pdf', finanzamt, expectFinanzamt],
  ['privatbrief.pdf', privatbrief, expectPrivat],
  ['vertrag.pdf', vertrag, expectVertrag],
  ['zweiseitig.pdf', zweiseitig, expectZweiseitig],
  ['mehrseitig.pdf', mehrseitig, expectMehrseitig],
];

module.exports = { SAMPLES, makeDoc };

if (require.main === module) {
  (async () => {
    const dir = process.argv[2] || path.join(__dirname, 'samples');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, build, expect] of SAMPLES) {
      fs.writeFileSync(path.join(dir, name), await makeDoc(build));
      fs.writeFileSync(path.join(dir, name.replace('.pdf', '.expect.json')), JSON.stringify(expect, null, 1));
    }
    console.log(`${SAMPLES.length} Beispiele in ${dir}`);
  })();
}
