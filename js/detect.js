// Lokale Erkennung: findet (möglicherweise) kritische Daten im Text und versteht deutsche Hinweise.
// Keine Netzwerkzugriffe, keine Abhängigkeiten – läuft im Browser und in Node (Tests).

import { FIRST_NAMES } from './data.js';

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Kleinbuchstaben, Umlaute ausgeschrieben, Satzzeichen weg – für Schlüsselwortvergleiche. */
export function normalize(s) {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[-–]/g, '')
    .replace(/[^a-z0-9@ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

/** Baut aus einem gesprochenen Begriff ein tolerantes Suchmuster (Groß/klein, Umlaute, Leer-/Bindestriche). */
export function termPattern(term) {
  const chunks = term.trim().split(/[\s\-–_]+/).filter(Boolean);
  return chunks
    .map((chunk) => {
      let out = '';
      for (let i = 0; i < chunk.length; i++) {
        const two = chunk.slice(i, i + 2).toLowerCase();
        const c = chunk[i].toLowerCase();
        if (two === 'ae' || two === 'oe' || two === 'ue') {
          out += `(?:${two}|${{ ae: 'ä', oe: 'ö', ue: 'ü' }[two]})`;
          i++;
        } else if (two === 'ss') {
          out += '(?:ss|ß)';
          i++;
        } else if (c === 'ä') out += '(?:ä|ae)';
        else if (c === 'ö') out += '(?:ö|oe)';
        else if (c === 'ü') out += '(?:ü|ue)';
        else if (c === 'ß') out += '(?:ß|ss)';
        else out += escapeRx(chunk[i]);
      }
      return out;
    })
    .join('[\\s\\-–./]*');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Kölner Phonetik – erkennt deutsch gleich klingende Wörter (Meier/Mayer/Maier). */
export function koelner(word) {
  const s = normalize(word).replace(/[^a-z]/g, '');
  let codes = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i], prev = s[i - 1] || '', next = s[i + 1] || '';
    let code = '';
    if ('aeijouy'.includes(c)) code = '0';
    else if (c === 'h') code = '-';
    else if (c === 'b') code = '1';
    else if (c === 'p') code = next === 'h' ? '3' : '1';
    else if (c === 'd' || c === 't') code = 'csz'.includes(next) ? '8' : '2';
    else if ('fvw'.includes(c)) code = '3';
    else if ('gkq'.includes(c)) code = '4';
    else if (c === 'c') {
      if (i === 0) code = 'ahkloqrux'.includes(next) ? '4' : '8';
      else code = 'sz'.includes(prev) ? '8' : 'ahkoqux'.includes(next) ? '4' : '8';
    } else if (c === 'x') code = 'ckq'.includes(prev) ? '8' : '48';
    else if (c === 'l') code = '5';
    else if (c === 'm' || c === 'n') code = '6';
    else if (c === 'r') code = '7';
    else if (c === 's' || c === 'z') code = '8';
    codes += code;
  }
  codes = codes.replace(/-/g, '');
  let out = '';
  for (const ch of codes) if (ch !== out[out.length - 1]) out += ch;
  return out[0] + out.slice(1).replace(/0/g, '');
}

function similar(a, b) {
  const na = normalize(a).replace(/ /g, ''), nb = normalize(b).replace(/ /g, '');
  if (na === nb) return true;
  const len = Math.max(na.length, nb.length);
  if (Math.min(na.length, nb.length) < 4) return false;
  const ratio = 1 - levenshtein(na, nb) / len;
  if (ratio >= 0.8) return true;
  return ratio >= 0.6 && koelner(na) === koelner(nb);
}

// ---------------------------------------------------------------------------
// Kategorien (Datentypen, die per Sprache angesprochen werden können)
// ---------------------------------------------------------------------------

const DAY = '(?:0?[1-9]|[12]\\d|3[01])';
const MONTH_NAMES =
  'Januar|Jänner|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jan|Feb|Mär|Apr|Jun|Jul|Aug|Sept|Sep|Okt|Nov|Dez';
const DATE_ANY =
  `(?:${DAY}\\.\\s?(?:0?[1-9]|1[0-2])\\.\\s?(?:\\d{4}|\\d{2})(?!\\d)` +
  `|\\d{4}-\\d{2}-\\d{2}` +
  `|${DAY}\\.\\s?(?:${MONTH_NAMES})\\.?(?:\\s?\\d{4})?)`;
const B = '(?<![\\p{L}\\p{N}])'; // Wortanfang (Unicode-fähig)
const E = '(?![\\p{L}\\p{N}])'; // Wortende
const CAP = "[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?";
// Titel vor Namen und Wörter, die nach „Frau“/„Ihre“ usw. kein Name sind
const TITLES = '(?:(?:Dr|Prof|Dipl\\.-\\p{L}+|med|rer|nat|dent|vet|jur|phil|habil|h\\.[ ]?c)\\.?[ ]+|(?:Kollegin|Kollege|Doktor|Professor(?:in)?)[ ]+)*';
const NAMEW = `(?!(?:Ihr|Ihre|Ihres|Ihren|Dein|Deine|Euer|Eure|Team|Abteilung|Die|Der|Das|Kollegin|Kollege|Herrn?|Frau|Familie)(?![\\p{L}]))${CAP}`;
const FN = [...FIRST_NAMES].sort((a, b) => b.length - a.length).join('|');

function ibanValid(raw) {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return false;
  const re = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of re) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

/** Prüfziffer der Steuer-Identifikationsnummer (ISO 7064, MOD 11,10). */
function taxIdValid(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || d[0] === '0') return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (Number(d[i]) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  return (11 - product) % 10 === Number(d[10]);
}

function luhnValid(raw) {
  const d = raw.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

/** IBAN: längste gültige Teilfolge finden (falls direkt dahinter z. B. „BIC“ steht). */
function findIban(text) {
  const out = [];
  // Auch über einen Zeilenumbruch hinweg (Fließtext bricht IBANs oft mitten in der Nummer um)
  const rx = /(?<![A-Z0-9])[A-Z]{2}\d{2}(?:[ \n]?[A-Z0-9]{4}){2,7}(?:[ \n]?[A-Z0-9]{1,3})?/g;
  for (const m of text.matchAll(rx)) {
    let s = m[0];
    while (s.replace(/\s/g, '').length >= 15) {
      if (ibanValid(s)) { out.push({ start: m.index, end: m.index + s.length }); break; }
      s = s.slice(0, -1).trimEnd();
    }
  }
  return out;
}

/**
 * Jede Kategorie: id, Anzeigename, Sprachmuster (auf normalisiertem Text),
 * und Suchmuster für das Dokument. `group` = nur diese Klammergruppe schwärzen.
 */
export const CATEGORIES = [
  {
    id: 'email', label: 'E-Mail-Adressen',
    say: /\b(e ?mail\w*|mailadress\w*|emailadress\w*)\b/,
    patterns: [{ rx: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g }],
  },
  {
    id: 'phone', label: 'Telefon-/Faxnummern',
    say: /\b(telefon\w*|tel|handy\w*|mobil\w*|fax\w*|rufnummer\w*|festnetz\w*|phone\w*)\b/,
    patterns: [{
      rx: /(?<![\w+])(?:(?:\+|00)\d{1,3}[ \-\/]*(?:\(0\)[ \-\/]*)?|\(?0)\d{1,5}\)?(?:[ \-\/]*\d+){1,5}(?!\w)/g,
      valid: (s) => { const n = s.replace(/\D/g, '').length; return n >= 6 && n <= 15; },
    }],
    exclude: findIban, // Ziffernblöcke einer IBAN sind keine Telefonnummer
  },
  {
    id: 'iban', label: 'IBAN / Kontonummern',
    say: /\b(iban\w*|kontonummer\w*|konto\w*|bankverbindung\w*|bankdaten)\b/,
    find: findIban,
    patterns: [{ rx: /(?:Konto(?:-?Nr\.?|nummer)|Kto\.?-?Nr\.?)\s*[:.]?\s*(\d[\d ]{4,14}\d)/gi, group: 1 }],
  },
  {
    id: 'bic', label: 'BIC / SWIFT',
    say: /\b(bic\w*|swift\w*|bankverbindung\w*|bankdaten)\b/,
    patterns: [{ rx: /\b(?:BIC|SWIFT)(?:[\s\-]?Code)?\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/g, group: 1 }],
  },
  {
    id: 'birthdate', label: 'Geburtsdaten',
    say: /\b(geburts\w*|geboren\w*)\b/,
    patterns: [{
      rx: new RegExp(`(?:geb\\.|geboren(?:\\s+am)?|Geburtsdatum|Geb\\.-Datum|Geburtstag)\\s*:?\\s*(${DATE_ANY})`, 'gi'),
      group: 1,
    }],
  },
  {
    id: 'date', label: 'Datumsangaben',
    say: /\b(datum\w*|datumsangabe\w*|termin\w*)\b/,
    patterns: [{ rx: new RegExp(`${B}${DATE_ANY}`, 'giu') }],
  },
  {
    id: 'address', label: 'Adressen (Straße, PLZ/Ort)',
    say: /\b(adress\w*|anschrift\w*|strasse\w*|wohnort\w*|plz|postleitzahl\w*|wohnsitz\w*)\b/,
    patterns: [
      {
        rx: /(?<![\p{L}\p{N}])((?:[A-ZÄÖÜ][a-zäöüß]+[\- ])?(?:[A-ZÄÖÜ][a-zäöüß]*)?(?:[Ss]tra(?:ß|ss)e|[Ss]tr\.|[Ww]eg|[Aa]llee|[Pp]latz|[Gg]asse|[Rr]ing|[Dd]amm|[Uu]fer|[Cc]haussee|[Ss]teig|[Pp]fad|[Mm]arkt|[Gg]raben|[Ww]all)[ ]?\d{1,4}[ ]?[a-zA-Z]?(?:[ ]?[-\/][ ]?\d{1,4}[a-z]?)?)(?![\p{L}\p{N}])/gu,
        group: 1,
      },
      { rx: /(?<![\p{L}\p{N}])((?:D-)?\d{5}[ \t]+[A-ZÄÖÜ][a-zäöüß]+(?:[\- ](?:am|an der|im|ob der|bei|[A-ZÄÖÜ][a-zäöüß]+)){0,2})/gu, group: 1 },
      { rx: /\bPostfach\s+\d[\d ]{1,8}\d/g },
      // Straße ohne typische Endung direkt vor der Postleitzahl: „Hafenkante 12 · 20457 Hamburg“, „Neuer Wall 7, 20354 …“
      { rx: /(?<![\p{L}\p{N}])((?:[A-ZÄÖÜ][a-zäöüß\-]+[ ])?[A-ZÄÖÜ][a-zäöüß\-]{2,}[ ]\d{1,4}[ ]?[a-zA-Z]?)(?=[ ]?(?:,|·|\||•|\n)[ ]*(?:D-)?\d{5}[ ]\p{Lu})/gu, group: 1 },
      // „Am Mühlbach 3“, „An der Alster 12“, „Im Grund 4“
      { rx: /(?<![\p{L}\p{N}])((?:Am|An der|An den|Auf der|Auf dem|Im|In der|Zum|Zur|Hinter der|Unter den)[ ][A-ZÄÖÜ][a-zäöüß]+(?:[\- ][A-ZÄÖÜ][a-zäöüß]+)?[ ]\d{1,4}[ ]?[a-zA-Z]?)(?![\p{L}\p{N}])/gu, group: 1 },
    ],
  },
  {
    id: 'url', label: 'Webadressen / Links',
    say: /\b(url\w*|links?|webseite\w*|website\w*|homepage\w*|internetadress\w*|webadress\w*|domain\w*|url)\b/,
    patterns: [{ rx: /\b(?:https?:\/\/|www\.)[^\s<>"]+[^\s<>".,;:!?)\]]/gi }],
  },
  {
    id: 'ip', label: 'IP-Adressen',
    say: /\b(ipadress\w*|ips?)\b/,
    patterns: [{ rx: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g }],
  },
  {
    id: 'amount', label: 'Geldbeträge',
    say: /\b(betrag|betraege|betraegen|geldbetra\w*|summe\w*|preis\w*|euro\w*|gehalt\w*|gehaelter|kosten|honorar\w*|zahlbetra\w*|rechnungsbetra\w*|geld)\b/,
    patterns: [{
      rx: /(?:(?:€|EUR|CHF|USD|\$)\s?-?\d{1,3}(?:[.'\s]?\d{3})*(?:,\d{1,2})?(?:,-)?|-?\d{1,3}(?:[.']\d{3})*(?:,\d{1,2}|,-)?\s?(?:€|EUR|Euro|CHF|USD|\$)|-?\d+(?:,\d{1,2}|,-)?\s?(?:€|EUR|Euro|CHF|USD))/g,
    }],
  },
  {
    id: 'creditcard', label: 'Kreditkartennummern',
    say: /\b(kreditkarte\w*|kartennummer\w*|karte)\b/,
    patterns: [{ rx: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, valid: luhnValid }],
  },
  {
    id: 'taxid', label: 'Steuer-ID / Steuernummer / USt-ID',
    say: /\b(steuer ?id\w*|steuerid\w*|steueridentifikation\w*|steuernummer\w*|umsatzsteuer\w*|ust ?id\w*|steuer\w*)\b/,
    patterns: [
      { rx: /(?:Steuer-?ID|Steuer-?Identifikationsnummer|Identifikationsnummer|IdNr\.?)[^:\n\d]{0,25}[:.]?\s*(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})(?!\d)/gi, group: 1 },
      // Steuer-ID ohne Beschriftung: nur mit gültiger Prüfziffer
      { rx: /(?<!\d ?)\d{2} \d{3} \d{3} \d{3}(?! ?\d)|(?<!\d)[1-9]\d{10}(?!\d)/g, valid: taxIdValid },
      { rx: /(?:Steuer-?Nr\.?|Steuernummer|St\.?-?Nr\.?)\s*[:.]?\s*(\d[\d\/ ]{8,15}\d)/gi, group: 1 },
      { rx: /\b(?:DE|ATU)\s?\d{8,9}\b/g },
    ],
  },
  {
    id: 'svnr', label: 'Sozialversicherungsnummern',
    say: /\b(sozialversicherung\w*|sv ?nummer\w*|svnr|rentenversicherung\w*|versicherungsnummer\w*)\b/,
    patterns: [{ rx: /\b\d{2}\s?\d{6}\s?[A-Z]\s?\d{3}\b/g }],
  },
  {
    id: 'names', label: 'Personennamen (Anrede, „Name:“, Grußformel)',
    say: /\b(namen|name|personennamen|personen|person|personendaten)\b/,
    patterns: [
      { rx: new RegExp(`(?<![\\p{L}])(?:Herrn?|Frau|Hr\\.|Fr\\.)[ ]+${TITLES}((?:${NAMEW}[ ]+){0,2}${NAMEW})`, 'gu'), group: 1 },
      { rx: new RegExp(`(?:Name|Vorname|Nachname|Familienname|Geburtsname|Ansprechpartner(?:in)?|Kontoinhaber(?:in)?|Patient(?:in)?|Mandant(?:in)?|Empfänger(?:in)?|Absender(?:in)?|Unterzeichner(?:in)?|Inhaber(?:in)?|Versicherte[rn]?|Antragsteller(?:in)?|Bearbeiter(?:in)?|Sachbearbeiter(?:in)?|Ehepartner(?:in)?|Kind|Vater|Mutter|Arzt|Ärztin|Mieter(?:in)?|Vermieter(?:in)?|Kunde|Kundin|Schuldner(?:in)?|Gläubiger(?:in)?)[ ]*:[ ]*((?:${CAP}[ ]+){0,2}${CAP})`, 'gu'), group: 1 },
      { rx: new RegExp(`(?:Mit (?:\\p{L}+ ){0,2}Grüßen|Viele Grüße|Beste Grüße|Freundliche Grüße|Herzliche Grüße|Hochachtungsvoll)[,]?[ \\t]*\\n(?:[ \\t]*(?:Ihre?|i\\.[ ]?A\\.|i\\.[ ]?V\\.|ppa\\.)[^\\n]*\\n){0,2}[ \\t]*${TITLES}((?:${NAMEW}[ ]+){0,2}${NAMEW})`, 'gu'), group: 1 },
      // Bekannter Vorname + großgeschriebenes Wort („Erika Meyer“, „Anna Maria Schmidt“)
      { rx: new RegExp(`(?<![\\p{L}])((?:${FN})(?:[ ]+(?:${FN}))?[ ]+${CAP})(?![\\p{L}])`, 'gu'), group: 1 },
    ],
    // Gefundene Namen werden überall im Dokument gesucht (auch ohne Anrede).
    propagate: true,
  },
  {
    id: 'idnumber', label: 'Kennnummern (Versicherungs-, Kunden-, Vertragsnummern …)',
    say: /\b(kennnummer\w*|kundennummern|vertragsnummern|aktenzeichen|nummern|ids?|kennzeichen)\b/,
    find: findLabeledIds,
    patterns: [],
  },
  {
    id: 'personal', label: 'Persönliche Angaben (Geburtsort, Gesundheit, Religion …)',
    say: /\b(gesundheit\w*|diagnose\w*|religion\w*|persoenliche angaben|geburtsort\w*|staatsangehoerigkeit\w*)\b/,
    find: findPersonal,
    patterns: [],
  },
  {
    id: 'kfz', label: 'Kfz-Kennzeichen',
    say: /\b(kfz\w*|autokennzeichen\w*|nummernschild\w*)\b/,
    patterns: [{ rx: /(?<![\p{L}\p{N}\-])[A-ZÄÖÜ]{1,3}-[A-Z]{1,2}[ ]?\d{1,4}[EH]?(?![\p{L}\p{N}])/gu }],
  },
  {
    id: 'number', label: 'Sonstige Nummern',
    say: /\b(zahlen|ziffern|nummernfolgen)\b/,
    find: findLongNumbers,
    patterns: [],
  },
];

// ---------------------------------------------------------------------------
// Automatischer Scan: alle Kategorien, bewertet und nach Wert gruppiert
// ---------------------------------------------------------------------------

/** Reihenfolge = Vorrang bei Überschneidungen (spezifisch vor allgemein). */
const SCAN_ORDER = ['iban', 'creditcard', 'svnr', 'taxid', 'email', 'url', 'ip', 'bic', 'birthdate', 'personal', 'idnumber',
  'phone', 'address', 'names', 'kfz', 'date', 'amount', 'number'];

const RISK = {
  iban: 'hoch', creditcard: 'hoch', svnr: 'hoch', taxid: 'hoch', birthdate: 'hoch', hint: 'hoch',
  email: 'mittel', phone: 'mittel', names: 'mittel', address: 'mittel', bic: 'mittel', idnumber: 'mittel', personal: 'mittel',
  ip: 'mittel', kfz: 'mittel',
  url: 'niedrig', date: 'niedrig', amount: 'niedrig', number: 'niedrig', image: 'niedrig',
};

export const SHORT = {
  iban: 'IBAN', creditcard: 'Kreditkarte', svnr: 'Sozialversicherungsnr.', taxid: 'Steuer-ID / -Nr.', email: 'E-Mail',
  url: 'Webadresse', ip: 'IP-Adresse', bic: 'BIC', birthdate: 'Geburtsdatum', phone: 'Telefon', idnumber: 'Nummer',
  personal: 'Persönliche Angabe', address: 'Adresse', names: 'Name', kfz: 'Kfz-Kennzeichen', date: 'Datum',
  amount: 'Betrag', number: 'Nummer', hint: 'Dein Hinweis', image: 'Bild',
};

function riskOf(cat, label) {
  if (cat === 'idnumber') return ID_HIGH.test(label || '') ? 'hoch' : 'mittel';
  if (cat === 'personal') return PERSONAL_HIGH.test(label || '') ? 'hoch' : 'mittel';
  return RISK[cat] || 'mittel';
}

/** Schlüssel, unter dem gleiche Werte zusammengefasst werden. */
export function valueKey(cat, text) {
  if (cat === 'names') {
    const last = normalize(text).split(' ').pop();
    return `names|${last}`;
  }
  return `${cat}|${normalize(text).replace(/ /g, '')}`;
}

function overlapsAny(list, m) {
  return list.some((o) => m.start < o.end && o.start < m.end);
}

/** Alle Kandidaten aller Kategorien (noch mit Überschneidungen). prio = Vorrang. */
export function scanCandidates(pages) {
  const cands = [];
  SCAN_ORDER.forEach((cat, prio) => {
    for (const m of findMatches({ kind: 'category', cat }, pages)) {
      cands.push({ ...m, cat, prio, label: m.label || contextLabel(cat, pages[m.page], m.start) });
    }
  });
  return cands;
}

const LABEL_ADOPT = new Set(['taxid', 'svnr', 'iban', 'bic', 'phone', 'email', 'birthdate', 'creditcard', 'date', 'amount', 'number']);
/** Beschriftung direkt vor dem Wert („Steuernummer: …“) als Bezeichnung übernehmen. */
function contextLabel(cat, text, start) {
  if (!LABEL_ADOPT.has(cat)) return undefined;
  const prefix = text.slice(Math.max(0, text.lastIndexOf('\n', start - 1) + 1), start);
  const m = prefix.match(/([\p{L}][\p{L}\-.]*(?:[ ][\p{L}][\p{L}\-.]*){0,2})[ \t]*[:#][ \t]*$/u);
  if (!m || m[1].length > 35) return undefined;
  const label = m[1].replace(/\.$/, '');
  // Nur sinnvolle Beschriftungen (keine Namen o. Ä.): mindestens ein kleingeschriebenes Wort oder bekannte Abkürzung
  return /[a-zäöü]{3}|^(IBAN|BIC|USt|SWIFT|Tel|Fax)/.test(label) ? label : undefined;
}

export const PRIO = Object.fromEntries(SCAN_ORDER.map((c, i) => [c, i]));

/** Überschneidungen auflösen: spezifische Kategorie vor allgemeiner, bei gleicher die längere Stelle. */
export function claimCandidates(cands, pageCount) {
  const sorted = [...cands].sort((a, b) => a.prio - b.prio || (b.end - b.start) - (a.end - a.start));
  const claimed = Array.from({ length: pageCount }, () => []);
  for (const c of sorted) {
    if (!c.text.trim() || overlapsAny(claimed[c.page], c)) continue;
    claimed[c.page].push(c);
  }
  return claimed.flat().sort((a, b) => a.page - b.page || a.start - b.start);
}

/** Gleiche Werte (gleiche Kategorie, gleiche Zuordnung) zu einem Fund zusammenfassen. */
export function groupOccurrences(cands) {
  const groups = new Map();
  const ownerKey = (c) => (c.owner ? `|${c.owner}` : '');
  for (const c of cands) {
    const key = valueKey(c.cat, c.text) + ownerKey(c);
    if (!groups.has(key)) {
      groups.set(key, { key, cat: c.cat, label: c.label || SHORT[c.cat], risk: riskOf(c.cat, c.label), owner: c.owner, occurrences: [] });
    }
    groups.get(key).occurrences.push({ page: c.page, start: c.start, end: c.end, text: c.text });
  }
  // „Mustermanns“ (Genitiv) zur Person „Mustermann“ legen
  for (const [key, g] of groups) {
    if (g.cat !== 'names') continue;
    const [, base0, suffix = ''] = key.match(/^(.*?)(\|(?:person|sender))?$/);
    if (!base0.endsWith('s')) continue;
    const base = groups.get(base0.slice(0, -1) + suffix);
    if (base && base !== g) { base.occurrences.push(...g.occurrences); groups.delete(key); }
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.occurrences.sort((a, b) => a.page - b.page || a.start - b.start);
    const texts = [...new Set(g.occurrences.map((o) => o.text.replace(/\s+/g, ' ').trim()))];
    g.value = texts.reduce((a, b) => (b.length > a.length ? b : a));
    g.variants = texts.filter((t) => t !== g.value);
  }
  return sortFindings(out);
}

const RISK_ORDER = { hoch: 0, mittel: 1, niedrig: 2 };
export function sortFindings(list) {
  const first = (f) => f.occurrences[0] || { page: 0, start: 0 };
  return list.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || first(a).page - first(b).page || first(a).start - first(b).start);
}

/**
 * Durchsucht alle Seiten nach möglicherweise kritischen Daten (nur Text, ohne Seitenlayout).
 * Rückgabe: [{ key, cat, label, risk, value, variants, occurrences: [{page, start, end, text}] }]
 */
export function scanDocument(pages) {
  return groupOccurrences(claimCandidates(scanCandidates(pages), pages.length));
}

export { riskOf };

// Wert hinter einer Bezeichnung wie „Versicherungsnummer: 12 345678 A 123“ oder „Aktenzeichen 4 O 123/24“
const ID_LABEL = /(?<![\p{L}])((?:[\p{L}][\p{L}\-]*?(?:nummer|Nummer|-Nr\.?|-ID|-Id|kennung|Kennung|kennzeichen|Kennzeichen|zeichen|Zeichen|code|Code))|Nr\.|No\.|Az\.|ID|Ihr Zeichen|Unser Zeichen|Pass-?Nr\.?)(?![\p{L}])[ \t]*[:#.]?[ \t]*/gu;
const ID_HIGH = /versicher|ausweis|pass|führerschein|patient|steuer|sozial|renten|kranken|personal|identifikation/i;
const REGISTER = /(?<![\p{L}])(?:HRB|HRA|VR|GnR|PR)[ ]?\d{2,7}(?:[ ]?[A-Z]{1,2})?(?![\p{L}\p{N}])/gu;
const ID_SKIP = /^(?:telefon|tel|fax|handy|mobil|ruf|durchwahl|konto|iban|haus|seiten|blatt|zimmer|raum|steuer|sozialversicherung|versicherungsnummer)/i;

/** Liest einen Kennwert ab Position `pos` (gleiche Zeile). Rückgabe: Ende des Werts oder -1. */
function idValueEnd(text, pos) {
  const lineEnd = text.indexOf('\n', pos) < 0 ? text.length : text.indexOf('\n', pos);
  const rest = text.slice(pos, lineEnd);
  const toks = [...rest.matchAll(/\S+/g)];
  let end = -1, digits = 0;
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i][0];
    const t = raw.replace(/[,;)]+$/, '').replace(/\.$/, '');
    const gap = i ? toks[i].index - (toks[i - 1].index + toks[i - 1][0].length) : toks[i].index;
    if (gap > 4) break;
    const next = toks[i + 1]?.[0] || '';
    const hasDigit = /\d/.test(t);
    const sep = /^[\/\-–]$/.test(t);
    const shortCaps = /^[A-Z]{1,3}$/.test(t) && /\d/.test(next);
    const code = /^[A-Za-z0-9][A-Za-z0-9\-\/.]*$/.test(t);
    if (sep) { if (end < 0 || !/\d/.test(next)) break; continue; }
    if (i === 0 && !(hasDigit && code) && !shortCaps && !/^[A-Z]{1,4}[\-\/]/.test(t)) break;
    if (!((hasDigit && code) || shortCaps || (i === 0 && code))) break;
    digits += (t.match(/\d/g) || []).length;
    end = pos + toks[i].index + t.length;
    if (t.length !== raw.length && !/\.$/.test(raw)) break;
  }
  return digits >= 2 ? end : -1;
}

function findLabeledIds(text) {
  const out = [...text.matchAll(REGISTER)].map((m) => ({ start: m.index, end: m.index + m[0].length, label: 'Handelsregister' }));
  for (const m of text.matchAll(ID_LABEL)) {
    const label = m[1];
    if (ID_SKIP.test(label)) continue;
    let pos = m.index + m[0].length;
    // Beschriftung steht allein am Zeilenende → Wert in der nächsten Zeile (Spalten-/Tabellenlayout)
    if (/^[ \t]*(\n|$)/.test(text.slice(pos, pos + 40))) pos = text.indexOf('\n', pos) + 1;
    if (pos <= 0) continue;
    while (text[pos] === ' ' || text[pos] === '\t') pos++;
    const end = idValueEnd(text, pos);
    if (end > pos) out.push({ start: pos, end, label: label.replace(/[:.]$/, '') });
  }
  return out;
}

// Persönliche Angaben in Textform („Geburtsort: Hamburg“, „Diagnose: …“)
export const PERSONAL_LABELS = 'Geburtsort|Geburtsland|Staatsangehörigkeit|Nationalität|Familienstand|Konfession|Religion|Religionszugehörigkeit|Geschlecht|Diagnosen?|Befund|Krankenkasse|Krankenversicherung|Arbeitgeber(?:in)?|Beruf|Grad der Behinderung|Behinderung|Blutgruppe|Allergien|Allergie|Vorerkrankungen|Medikation|Medikamente|Steuerklasse|Kinder|Einkommen|Gehalt|Bruttogehalt|Nettogehalt';
const PERSONAL_HIGH = /diagnos|befund|religion|konfession|behinderung|blutgruppe|allergie|vorerkrank|medika/i;
function findPersonal(text) {
  const rx = new RegExp(`(?<![\\p{L}])(${PERSONAL_LABELS})[ \\t]*:[ \\t]*([^\\n]{1,80}?)[ \\t]*(?=\\n|$|[ \\t]{3,}|[,;]|[ \\t]+[\\p{L}][\\p{L}\\-.]*[ \\t]*:)`, 'gud');
  const out = [...text.matchAll(rx)].map((m) => ({ start: m.indices[2][0], end: m.indices[2][1], label: m[1] }));
  // „Diagnosen:“ allein in der Zeile → die folgenden Zeilen (bis Leerzeile oder nächste Beschriftung)
  const head = new RegExp(`(?<![\\p{L}])(${PERSONAL_LABELS})[ \\t]*:[ \\t]*\\n`, 'gu');
  for (const m of text.matchAll(head)) {
    let pos = m.index + m[0].length, end = -1;
    for (let n = 0; n < 8; n++) {
      const lineEnd = text.indexOf('\n', pos) < 0 ? text.length : text.indexOf('\n', pos);
      const line = text.slice(pos, lineEnd);
      if (!line.trim() || /^[\p{L}][\p{L} ,\-]{0,40}:/u.test(line.trim()) || line.length > 120) break;
      end = pos + line.trimEnd().length;
      pos = lineEnd + 1;
      if (lineEnd >= text.length) break;
    }
    if (end > 0) out.push({ start: m.index + m[0].length, end, label: m[1] });
  }
  return out;
}

/** Längere Ziffernfolgen, die sonst nirgends zugeordnet wurden (Vorgangs-, Kunden-, Policen-Nummern …). */
function findLongNumbers(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])[A-Z]{0,3}\d(?:[\d\-\/]|[ .](?=\d)|[ ][A-Z]{1,2}[ ](?=\d))*\d(?![\p{L}\p{N}])/gu)) {
    if ((m[0].match(/\d/g) || []).length >= 6) out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const PII = ['email', 'phone', 'iban', 'bic', 'birthdate', 'address', 'names', 'taxid', 'svnr', 'creditcard', 'ip'];
const SAY_ALL_PII = /\b(personenbezogen\w*|persoenlich\w*|sensib\w*|vertraulich\w*|alle daten|kontaktdaten)\b/;

export function categoryById(id) {
  return CATEGORIES.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// Befehle verstehen
// ---------------------------------------------------------------------------

const NUMBER_WORDS = {
  eins: 1, ein: 1, eine: 1, erste: 1, ersten: 1, zwei: 2, zweite: 2, zweiten: 2, drei: 3, dritte: 3, dritten: 3,
  vier: 4, vierte: 4, vierten: 4, fuenf: 5, fuenfte: 5, fuenften: 5, sechs: 6, sechste: 6, sechsten: 6,
  sieben: 7, siebte: 7, siebten: 7, acht: 8, achte: 8, achten: 8, neun: 9, neunte: 9, neunten: 9,
  zehn: 10, zehnte: 10, zehnten: 10, elf: 11, zwoelf: 12,
};

function parsePageNumber(word) {
  const w = normalize(word);
  if (/^\d+$/.test(w)) return Number(w);
  if (/^letzte/.test(w)) return -1;
  return NUMBER_WORDS[w] ?? null;
}

const CONTROL = [
  { action: 'apply', rx: /^(jetzt )?(anwenden|ausfuehren|los|fertig|ok|okay|bestaetigen|schwaerzen|alles schwaerzen|durchfuehren|umsetzen|mach es|machen|starten|entfernen|loeschen)( bitte)?$/ },
  { action: 'undo', rx: /^(rueckgaengig( machen)?|zurueck|undo|letzte\w* (befehl|regel|schritt|eingabe) (rueckgaengig|entfernen|loeschen|zuruecknehmen)|das war falsch)$/ },
  { action: 'reset', rx: /^(alles )?(zuruecksetzen|verwerfen|neu anfangen|von vorne)$|^(alle )?(regeln|treffer|markierungen) (loeschen|entfernen|verwerfen)$|^liste leeren$/ },
  { action: 'showResult', rx: /^(zeig(e)? )?(das )?(ergebnis|resultat|vorschau)( zeigen| anzeigen)?$/ },
  { action: 'showOriginal', rx: /^(zeig(e)? )?(das )?(original|vorher)( zeigen| anzeigen)?$/ },
];

const LEAD_FILLERS = new RegExp(
  '^(?:' + [
    'bitte', 'und', 'dann', 'noch', 'auch', 'jetzt', 'mal', 'nun', 'ausserdem', 'außerdem', 'zusätzlich', 'zusaetzlich',
    'ich möchte,? dass du', 'ich moechte,? dass du', 'ich möchte', 'ich moechte', 'ich will', 'kannst du', 'könntest du', 'koenntest du',
    'entferne', 'entfernen', 'entfern', 'lösche', 'löschen', 'lösch', 'loesche', 'loeschen',
    'schwärze', 'schwärzen', 'schwärz', 'schwaerze', 'schwaerzen', 'streiche', 'streichen', 'anonymisiere', 'anonymisieren',
    'verstecke', 'verstecken', 'verdecke', 'verdecken', 'tilge', 'tilgen', 'mache', 'mach', 'nimm', 'raus mit',
    'alle', 'alles', 'sämtliche', 'sämtlichen', 'saemtliche', 'jede', 'jeden', 'jedes', 'jegliche', 'jeglichen',
    'die', 'der', 'das', 'den', 'dem', 'des', 'eine', 'einen', 'ein', 'meine', 'meinen', 'meinem', 'seine', 'ihre',
    'vorkommen von', 'vorkommen des', 'vorkommen der', 'erwähnungen von', 'stellen mit', 'von', 'mit',
  ].join('|') + ')\\s+',
  'i',
);
const TRAIL_FILLERS = new RegExp(
  '\\s+(?:' + [
    'weg', 'raus', 'heraus', 'entfernen', 'löschen', 'loeschen', 'schwärzen', 'schwaerzen', 'bitte', 'überall', 'ueberall',
    'komplett', 'vollständig', 'vollstaendig', 'aus dem dokument', 'im dokument', 'in dem dokument', 'aus dem pdf', 'im pdf',
    'aus der datei', 'in der datei', 'unkenntlich', 'machen', 'an',
  ].join('|') + ')$',
  'i',
);

function stripFillers(s) {
  let prev;
  s = s.replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, '');
  do {
    prev = s;
    s = s.replace(LEAD_FILLERS, '').replace(TRAIL_FILLERS, '').replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, '');
  } while (s !== prev);
  return s;
}

/** Vereinfacht Sprachmuster, die sonst falsch erkannt würden („E-Mail Adressen“ ≠ „Adressen“). */
function sayNormalize(s) {
  return normalize(s)
    .replace(/\be ?mail ?adress/g, 'emailadress')
    .replace(/\b(internet|web) ?adress\w*/g, 'url')
    .replace(/\bip ?adress/g, 'ipadress')
    .replace(/\bsteuer ?(id|nummer)/g, 'steuer$1');
}

let ruleCounter = 0;
function makeRule(r) {
  return { id: `r${++ruleCounter}`, ...r };
}

/**
 * Wandelt einen gesprochenen/getippten Befehl in Aktionen um.
 * Rückgabe: { action: 'add'|'apply'|'undo'|'reset'|'save'|'showResult'|'showOriginal'|'none', rules, saveName }
 */
export function parseCommand(input) {
  const raw = (input || '').trim();
  const norm = normalize(raw).replace(/^(bitte|jetzt|und|ok|okay) /, '').replace(/ bitte$/, '');
  if (!norm) return { action: 'none', rules: [] };

  const save = raw.match(/^(?:bitte\s+)?(?:datei\s+)?(?:speichern|sichern|abspeichern|speichere|sichere)(?:\s+(?:unter|als)\s+(?:dem namen\s+|den namen\s+)?(.+?))?[.!]?$/i);
  if (save) return { action: 'save', rules: [], saveName: save[1] ? stripFillers(save[1]) : null };
  for (const c of CONTROL) if (c.rx.test(norm)) return { action: c.action, rules: [] };

  let text = raw;

  // Seitenangabe („auf Seite 2“, „auf den Seiten 2 bis 4“, „nur auf der letzten Seite“)
  let pages = null;
  const pageRx = /\b(?:nur\s+)?(?:auf|in)\s+(?:der\s+|den\s+)?(\S+\s+)?seiten?\s*(\S+)?(?:\s*(?:bis|-|und)\s*(\S+))?/i;
  const pm = text.match(pageRx);
  if (pm) {
    const a = parsePageNumber((pm[1] || pm[2] || '').trim().replace(/[.,]$/, ''));
    const b = pm[3] ? parsePageNumber(pm[3].replace(/[.,]$/, '')) : null;
    if (a !== null) {
      pages = b !== null && b !== a ? { from: a, to: b } : { from: a, to: a };
      text = text.replace(pm[0], ' ');
    }
  }

  // Wörter in Anführungszeichen bleiben unverändert
  const quoted = [];
  text = text.replace(/["„“”»«‚‘'']([^"„“”»«‚‘'']+)["„“”»«‚‘'']/g, (_, q) => {
    quoted.push(q.trim());
    return ` §${quoted.length - 1}§ `;
  });

  const rules = [];
  const segments = text.split(/\s*(?:[,;]|\bund\b|\bsowie\b|\bausserdem\b|\baußerdem\b|\bplus\b|\bzusätzlich\b)\s*/i);
  for (let seg of segments) {
    seg = stripFillers(seg);
    if (!seg) continue;

    const q = seg.match(/§(\d+)§/);
    if (q) {
      rules.push(makeRule({ kind: 'term', termKind: 'literal', term: quoted[Number(q[1])], pages }));
      continue;
    }

    let m = seg.match(/^(?:das wort|die worte|die wörter|die woerter|den begriff|die begriffe|den text|die zeichenfolge|die phrase|den ausdruck|den satz|wort|wörter|begriff|text|ausdruck)\s+(.+)$/i);
    if (m) { rules.push(makeRule({ kind: 'term', termKind: 'literal', term: stripFillers(m[1]), pages })); continue; }

    m = seg.match(/^(?:den namen|die namen|namen|name|die person|person|herrn|herr|frau|hr\.?|fr\.?|dr\.?)\s+(.+)$/i);
    if (m) { rules.push(makeRule({ kind: 'term', termKind: 'name', term: stripFillers(m[1]), pages })); continue; }

    m = seg.match(/^(?:die firma|firma|das unternehmen|unternehmen|die organisation|organisation|die stadt|stadt|den ort|ort)\s+(.+)$/i);
    if (m) { rules.push(makeRule({ kind: 'term', termKind: 'literal', term: stripFillers(m[1]), pages })); continue; }

    const say = sayNormalize(seg);
    if (SAY_ALL_PII.test(say)) {
      for (const id of PII) rules.push(makeRule({ kind: 'category', cat: id, pages }));
      continue;
    }
    const cats = CATEGORIES.filter((c) => c.say.test(say));
    // Nur Kategorie, wenn das Segment im Wesentlichen aus Kategoriewörtern besteht
    // (sonst ist es ein Suchbegriff wie „Telefonica GmbH“).
    const rest = say.replace(new RegExp(CATEGORIES.map((c) => c.say.source).join('|'), 'g'), '')
      .replace(/\b(und|oder|nummern?|angaben?|daten|adressen?|alle|die|der|das|von|aller)\b/g, '').trim();
    if (cats.length && rest.length <= 2) {
      for (const c of cats) rules.push(makeRule({ kind: 'category', cat: c.id, pages }));
      continue;
    }
    rules.push(makeRule({ kind: 'term', termKind: 'auto', term: seg, pages }));
  }
  return { action: rules.length ? 'add' : 'none', rules };
}

export function ruleLabel(rule) {
  let s;
  if (rule.kind === 'category') s = categoryById(rule.cat).label;
  else if (rule.kind === 'manual') s = 'Manuell markierte Bereiche';
  else s = `${rule.termKind === 'name' ? 'Name' : 'Begriff'} „${rule.term}“`;
  if (rule.pages) s += rule.pages.from === rule.pages.to ? ` (Seite ${fmtPage(rule.pages.from)})` : ` (Seiten ${fmtPage(rule.pages.from)}–${fmtPage(rule.pages.to)})`;
  return s;
}
function fmtPage(n) { return n === -1 ? 'letzte' : n; }

// ---------------------------------------------------------------------------
// Treffer im Dokument finden
// ---------------------------------------------------------------------------

function runPattern(p, text) {
  const out = [];
  const flags = p.rx.flags.includes('d') ? p.rx.flags : p.rx.flags + 'd';
  const rx = new RegExp(p.rx.source, flags);
  for (const m of text.matchAll(rx)) {
    const [s, e] = p.group ? m.indices[p.group] || [] : m.indices[0];
    if (s === undefined || e <= s) continue;
    const str = text.slice(s, e);
    if (p.valid && !p.valid(str)) continue;
    out.push({ start: s, end: e });
  }
  return out;
}

function findLiteral(term, text, { genitive = false } = {}) {
  const src = termPattern(term);
  if (!src) return [];
  const rx = new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})${genitive ? "(?:s|'s|’s)?" : ''}(?![\\p{L}\\p{N}])`, 'giu');
  return [...text.matchAll(rx)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

function tokenize(text) {
  return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)].map((m) => ({ s: m.index, e: m.index + m[0].length, w: m[0] }));
}

/** Ähnlich klingende Schreibweisen (z. B. Spracherkennung „Maier“, Dokument „Meyer“). */
function findFuzzy(term, text) {
  const joined = normalize(term).replace(/ /g, '');
  if (joined.length < 4) return [];
  const n = term.trim().split(/\s+/).length;
  const toks = tokenize(text);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    for (let k = 1; k <= Math.min(n + 1, 4) && i + k <= toks.length; k++) {
      const span = toks.slice(i, i + k);
      // Fenster dürfen keine Zeilenumbrüche überspannen
      if (k > 1 && /\n/.test(text.slice(span[0].e, span[k - 1].s))) break;
      const cand = normalize(span.map((t) => t.w).join(''));
      if (Math.abs(cand.length - joined.length) > Math.max(2, joined.length * 0.3)) continue;
      if (similar(joined, cand)) {
        out.push({ start: span[0].s, end: span[k - 1].e });
        i += k - 1;
        break;
      }
    }
  }
  return out;
}

/** „Kundennummer“ → findet den Wert hinter „Kundennummer:“ / „Kunden-Nr. 4711“. */
function findLabelValues(term, text) {
  let src = termPattern(term);
  const num = term.match(/^(.*?)[\s\-]?(?:nummer|nr\.?)$/i);
  if (num && num[1].length >= 3) src = `${termPattern(num[1])}[\\s\\-]?(?:nummer|nr\\.?|no\\.?|#)`;
  const out = [];
  const withColon = new RegExp(`(?<![\\p{L}])(?:${src})[ \\t]*[:#][ \\t]*([^\\n]{1,80}?)[ \\t]*(?=\\n|$|[ \\t]{3,})`, 'giu');
  const withDigit = new RegExp(`(?<![\\p{L}])(?:${src})[ \\t]+(\\d[\\p{L}\\p{N}\\-\\/.]*(?: \\p{N}[\\p{L}\\p{N}\\-\\/.]*)*)`, 'giu');
  for (const rx of [withColon, withDigit]) {
    const r = new RegExp(rx.source, rx.flags + 'd');
    for (const m of text.matchAll(r)) {
      const [s, e0] = m.indices[1];
      const e = s + text.slice(s, e0).replace(/[.,;:]+$/, '').length;
      if (e > s && !out.some((o) => o.start === s)) out.push({ start: s, end: e });
    }
  }
  return out;
}

function inPages(rule, pageIndex, pageCount) {
  if (!rule.pages) return true;
  const res = (n) => (n === -1 ? pageCount - 1 : n - 1);
  const from = res(rule.pages.from), to = res(rule.pages.to);
  return pageIndex >= Math.min(from, to) && pageIndex <= Math.max(from, to);
}

function dedupe(list) {
  list.sort((a, b) => a.page - b.page || a.start - b.start || b.end - a.end);
  const out = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.page === m.page && m.start < last.end) {
      // Überlappung: zusammenführen (exakte Treffer haben Vorrang)
      last.end = Math.max(last.end, m.end);
      last.fuzzy = last.fuzzy && m.fuzzy;
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

/**
 * Findet alle Treffer einer Regel.
 * pages: Array von Seitentexten. Rückgabe: [{page, start, end, text, fuzzy, note}]
 */
export function findMatches(rule, pages) {
  const results = [];
  const each = (fn) => pages.forEach((text, p) => {
    if (!inPages(rule, p, pages.length)) return;
    for (const r of fn(text, p)) results.push({ page: p, ...r });
  });

  if (rule.kind === 'category') {
    const cat = categoryById(rule.cat);
    each((text) => {
      const found = [...(cat.find ? cat.find(text) : []), ...cat.patterns.flatMap((p) => runPattern(p, text))];
      if (!cat.exclude) return found;
      const ex = cat.exclude(text);
      return found.filter((f) => !ex.some((x) => f.start < x.end && x.start < f.end));
    });
    if (cat.propagate) {
      // Gefundene Namen (und Nachnamen) überall suchen
      const names = new Set();
      for (const r of results) {
        const name = pages[r.page].slice(r.start, r.end).trim();
        names.add(name);
        const parts = name.split(/\s+/);
        if (parts.length > 1 && parts[parts.length - 1].length >= 3) names.add(parts[parts.length - 1]);
      }
      for (const name of names) each((text) => findLiteral(name, text, { genitive: true }));
    }
  } else if (rule.kind === 'term') {
    const term = rule.term;
    if (rule.termKind === 'auto') {
      const values = [];
      pages.forEach((text, p) => {
        if (inPages(rule, p, pages.length)) for (const r of findLabelValues(term, text)) values.push({ page: p, ...r, note: 'Wert hinter Bezeichnung' });
      });
      if (values.length) results.push(...values);
    }
    if (!results.length) {
      const genitive = rule.termKind !== 'literal';
      each((text) => findLiteral(term, text, { genitive }));
      if (rule.termKind === 'name') {
        // Einzelne Namensteile (z. B. nur der Nachname) ebenfalls
        const parts = term.split(/\s+/).filter((w) => w.length >= 3);
        if (parts.length > 1) {
          for (const part of parts) each((text) => findLiteral(part, text, { genitive: true }).map((r) => ({ ...r, note: 'Namensteil' })));
        }
      }
      const exact = results.length;
      each((text) => findFuzzy(term, text).map((r) => ({ ...r, fuzzy: true, note: 'ähnliche Schreibweise' })));
      if (rule.termKind === 'name' && !exact) {
        for (const part of term.split(/\s+/).filter((w) => w.length >= 4)) {
          each((text) => findFuzzy(part, text).map((r) => ({ ...r, fuzzy: true, note: 'ähnlicher Namensteil' })));
        }
      }
    }
  }

  return dedupe(results).map((m) => ({ ...m, text: pages[m.page].slice(m.start, m.end), fuzzy: !!m.fuzzy }));
}
