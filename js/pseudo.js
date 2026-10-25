// Pseudonymisierung: glaubwürdige Ersatzwerte mit derselben Struktur wie das Original
// und eine lokale Tabelle, damit derselbe Originalwert immer denselben Ersatz bekommt.
//
// Datenschutz der Tabelle: Originalwerte werden NICHT gespeichert – nur ein gesalzener
// SHA-256-Fingerabdruck (nicht umkehrbar), der Ersatzwert und ein maskierter Hinweis („DE89 … 00“).

import { normalize } from './detect.js';
import { ORG } from './structure.js';
import {
  FIRST_NAMES, FEMALE, FIRST_NAMES_F, FIRST_NAMES_M, LAST_NAMES, STREETS, CITIES, PUBLIC_MAIL_DOMAINS, FAKE_MAIL_DOMAINS,
} from './data.js';

// ---------------------------------------------------------------------------
// Zufall und Strukturerhalt
// ---------------------------------------------------------------------------

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[rnd(list.length)];
/** Zufällig, aber möglichst ähnlich lang wie das Original – damit der Ersatz ins Schriftbild passt. */
const pickLike = (list, original) => {
  const n = textWidth(original);
  for (const tol of [0.06, 0.12, 0.2, 0.35]) {
    const near = list.filter((x) => Math.abs(textWidth(x) - n) <= n * tol);
    if (near.length >= 3 || (tol === 0.35 && near.length)) return pick(near);
  }
  return pick(list);
};

/** Ungefähre Textbreite (in Zeichenbreiten einer serifenlosen Schrift). */
function textWidth(t) {
  let w = 0;
  for (const ch of t) {
    if (/[iljtfrI.,:;'!|\s]/.test(ch)) w += 0.3;
    else if (/[mwMW]/.test(ch)) w += 0.85;
    else if (/[A-ZÄÖÜ]/.test(ch)) w += 0.68;
    else w += 0.55;
  }
  return w;
}
const UPPER = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const LOWER = 'abcdefghijkmnoprstuvwxyz';

/** Ziffer → Ziffer, Groß → Groß, Klein → Klein; Trenner bleiben. Erste Ziffer bleibt ≠ 0, wenn sie es war. */
export function shapeFake(s) {
  let out = '', firstDigit = true;
  for (const ch of s) {
    if (/\d/.test(ch)) { out += firstDigit && ch !== '0' ? String(1 + rnd(9)) : String(rnd(10)); firstDigit = false; }
    else if (/[A-ZÄÖÜ]/.test(ch)) out += pick(UPPER);
    else if (/[a-zäöüß]/.test(ch)) out += pick(LOWER);
    else out += ch;
  }
  return out;
}

/** Überträgt die Zeichen von `compact` in das Leer-/Trennzeichenmuster von `pattern`. */
export function applyPattern(pattern, compact) {
  let i = 0, out = '';
  for (const ch of pattern) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += compact[i++] ?? '';
    else out += ch;
  }
  return out + compact.slice(i);
}

const compactOf = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');

function differs(make, original, tries = 20) {
  let v;
  do { v = make(); } while (--tries > 0 && compactOf(v).toLowerCase() === compactOf(original).toLowerCase());
  return v;
}

// ---------------------------------------------------------------------------
// Prüfziffern
// ---------------------------------------------------------------------------

function mod97(numStr) {
  let r = 0;
  for (const d of numStr) r = (r * 10 + Number(d)) % 97;
  return r;
}

export function fakeIban(original) {
  const c = compactOf(original).toUpperCase();
  const country = c.slice(0, 2);
  const bban = shapeFake(c.slice(4));
  const num = (bban + country + '00').replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  const check = String(98 - mod97(num)).padStart(2, '0');
  return applyPattern(original, country + check + bban);
}

export function fakeCard(original) {
  const c = compactOf(original);
  const body = c[0] + shapeFake(c.slice(1, -1)).replace(/\D/g, () => String(rnd(10)));
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let n = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return applyPattern(original, body + String((10 - (sum % 10)) % 10));
}

/** Steuer-Identifikationsnummer (11 Ziffern, Prüfziffer nach ISO 7064 MOD 11,10). */
export function fakeTaxId(original) {
  const c = compactOf(original);
  if (!/^\d{11}$/.test(c)) return shapeFake(original);
  const d = String(1 + rnd(9)) + Array.from({ length: 9 }, () => rnd(10)).join('');
  let product = 10;
  for (const ch of d) {
    let s = (Number(ch) + product) % 10;
    if (s === 0) s = 10;
    product = (s * 2) % 11;
  }
  const check = (11 - product) % 10;
  return applyPattern(original, d + check);
}

/** Rentenversicherungsnummer: Bereich, Geburtsdatum TTMMJJ, Buchstabe, Seriennr., Prüfziffer. */
export function fakeSvnr(original) {
  const c = compactOf(original).toUpperCase();
  if (!/^\d{8}[A-Z]\d{3}$/.test(c)) return shapeFake(original);
  const area = c.slice(0, 2);
  const dd = String(1 + rnd(28)).padStart(2, '0'), mm = String(1 + rnd(12)).padStart(2, '0');
  const yy = String(rnd(100)).padStart(2, '0');
  const letter = pick(UPPER);
  const serialNum = Number(c.slice(9, 11)) < 50 ? rnd(50) : 50 + rnd(50); // Geschlechtskennung beibehalten
  const serial = String(serialNum).padStart(2, '0');
  const digits = area + dd + mm + yy + String(letter.charCodeAt(0) - 64).padStart(2, '0') + serial;
  const w = [2, 1, 2, 5, 7, 1, 2, 1, 2, 1, 2, 1];
  let sum = 0;
  for (let i = 0; i < 12; i++) { const p = Number(digits[i]) * w[i]; sum += Math.floor(p / 10) + (p % 10); }
  return applyPattern(original, area + dd + mm + yy + letter + serial + (sum % 10));
}

// ---------------------------------------------------------------------------
// Datumswerte
// ---------------------------------------------------------------------------

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function fakeDate(original, { spreadDays = 900 } = {}) {
  let m = original.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})$/);
  let parts;
  if (m) parts = { d: +m[1], mo: +m[2], y: +m[3], kind: 'num' };
  else if ((m = original.match(/^(\d{4})-(\d{2})-(\d{2})$/))) parts = { d: +m[3], mo: +m[2], y: +m[1], kind: 'iso' };
  else if ((m = original.match(/^(\d{1,2})\.\s?(\p{L}+)\.?(?:\s?(\d{4}))?$/u))) {
    const idx = MONTHS.findIndex((n) => n.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3)));
    parts = { d: +m[1], mo: idx + 1 || 1, y: m[3] ? +m[3] : 2000, kind: 'name' };
  } else return shapeFake(original);
  const fullYear = parts.y < 100 ? (parts.y > 30 ? 1900 + parts.y : 2000 + parts.y) : parts.y;
  const base = new Date(Date.UTC(fullYear, parts.mo - 1, parts.d));
  const shift = (rnd(spreadDays) + 20) * (Math.random() < 0.5 ? -1 : 1);
  const n = new Date(base.getTime() + shift * 86400000);
  const D = n.getUTCDate(), M = n.getUTCMonth() + 1, Y = n.getUTCFullYear();
  const pad = (v, w) => String(v).padStart(w, '0');
  if (parts.kind === 'iso') return `${Y}-${pad(M, 2)}-${pad(D, 2)}`;
  if (parts.kind === 'name') {
    const name = MONTHS.includes(m[2]) || m[2] === 'Maerz' ? MONTHS[M - 1] : MONTHS[M - 1].slice(0, 3);
    return original.replace(m[1], String(D).padStart(m[1].length, '0')).replace(m[2], name).replace(m[3] || '\u0000', String(Y));
  }
  const [, od, om, oy] = original.match(/^(\d{1,2})\.(\s?)(\d{1,2})\.(\s?)(\d{2,4})$/) ? [null, ...original.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})$/).slice(1)] : [];
  const sep = original.includes('. ') ? '. ' : '.';
  return `${pad(D, od.length)}${sep}${pad(M, om.length)}${sep}${oy.length === 2 ? pad(Y % 100, 2) : Y}`;
}

// ---------------------------------------------------------------------------
// Namen (pro Namensbestandteil, damit „Max Mustermann“ und „Mustermann“ zusammenpassen)
// ---------------------------------------------------------------------------

const TITLE = /^(?:Dr\.?|Prof\.?|Dipl\.-[\p{L}]+\.?|med\.?|von|van|de|zu|Herrn?|Frau|Familie)$/u;

export function nameTokens(text) {
  return text.split(/[\s]+/).flatMap((t) => t.split(/(?<=-)|(?=-)/)).filter((t) => /\p{L}{2,}/u.test(t) && !TITLE.test(t));
}

function baseToken(tok, known) {
  const n = normalize(tok);
  if (n.endsWith('s') && known(n.slice(0, -1))) return { key: n.slice(0, -1), suffix: tok.slice(-1) };
  return { key: n, suffix: '' };
}

function newNameFor(tok) {
  let n;
  do n = pickName(tok); while (normalize(n) === normalize(tok));
  return n;
}

function pickName(tok) {
  const cap = (s) => (tok === tok.toUpperCase() && tok.length > 1 ? s.toUpperCase() : tok[0] === tok[0].toLowerCase() ? s.toLowerCase() : s);
  if (FIRST_NAMES.has(tok)) return cap(pickLike(FEMALE.has(tok) ? FIRST_NAMES_F : FIRST_NAMES_M, tok));
  return cap(pickLike(LAST_NAMES, tok));
}

// ---------------------------------------------------------------------------
// Lokale Tabelle
// ---------------------------------------------------------------------------

const TABLE_KEY = 'pdfprivacy.pseudonyms';

function normForHash(kind, value) {
  let v = value.trim();
  if (kind === 'phone') v = v.replace(/^\+49|^0049/, '0');
  if (kind === 'name') return normalize(v);
  if (kind === 'email') return v.toLowerCase();
  return compactOf(v).toUpperCase();
}

function mask(kind, value) {
  const c = compactOf(value);
  if (kind === 'name') return `${value.trim()[0].toUpperCase()}…`;
  if (c.length <= 4) return '•'.repeat(c.length);
  return `${c.slice(0, 2)}…${c.slice(-2)}`;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export class PseudonymTable {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = { salt: '', entries: {} };
    try { this.data = JSON.parse(storage?.getItem(TABLE_KEY) || 'null') || this.data; } catch { /* leer anfangen */ }
    if (!this.data.salt) {
      this.data.salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      this.save();
    }
  }

  save() {
    try { this.storage?.setItem(TABLE_KEY, JSON.stringify(this.data)); } catch { /* Speicher voll oder privat */ }
  }

  hash(kind, value) {
    return sha256(`${this.data.salt}|${kind}|${normForHash(kind, value)}`);
  }

  async lookup(kind, value) {
    return this.data.entries[await this.hash(kind, value)] || null;
  }

  async remember(kind, value, fake, label) {
    const h = await this.hash(kind, value);
    const prev = this.data.entries[h];
    this.data.entries[h] = { kind, label, fake, hint: mask(kind, value), created: prev?.created || Date.now(), used: Date.now() };
    this.save();
  }

  list() {
    return Object.entries(this.data.entries).map(([hash, e]) => ({ hash, ...e })).sort((a, b) => b.used - a.used);
  }

  remove(hash) { delete this.data.entries[hash]; this.save(); }
  clear() { this.data.entries = {}; this.save(); }
  export() { return JSON.stringify({ format: 'pdf-datenschutz-pseudonyme', version: 1, ...this.data }, null, 1); }

  import(json) {
    const d = JSON.parse(json);
    if (d.format !== 'pdf-datenschutz-pseudonyme' || !d.salt || typeof d.entries !== 'object') throw new Error('Keine gültige Pseudonym-Tabelle');
    // Fingerabdrücke hängen am Salz: bei anderem Salz Tabelle komplett übernehmen
    if (d.salt !== this.data.salt && Object.keys(this.data.entries).length) {
      throw new Error('Die Tabelle stammt von einem anderen Gerät. Bitte vorher die eigene Tabelle leeren.');
    }
    this.data = { salt: d.salt, entries: { ...this.data.entries, ...d.entries } };
    this.save();
  }
}

// ---------------------------------------------------------------------------
// Ersatzwerte für Funde
// ---------------------------------------------------------------------------

// Wörter in Blöcken, die nie ersetzt werden (Anrede, Titel, Land, Füllwörter)
const FREE_KEEP = /^(IBAN|BIC|SWIFT|USt|HRB|HRA|GmbH|AG|KG|Tel|Fax|Mobil|Herrn?|Frau|Familie|Firma|Eheleute|An|z|Hd|Dr|Prof|med|Dipl|Deutschland|Germany|Österreich|Schweiz|Postfach|Tel|Telefon|Fax|Mobil|E-Mail|Mail|Internet|Web|Hauptverwaltung|Zentrale|Die|Der|Das|Ihre?|Für|Und)$/i;
const ORG_WORDS = ['Nordstern', 'Sonnental', 'Lindenhof', 'Bergland', 'Talblick', 'Auental', 'Mühlenberg', 'Seeblick', 'Waldrand', 'Rosengarten'];

const TEXTUAL_PLACES = /ort|land|stadt|wohnort/i;

export class Pseudonymizer {
  constructor(table) {
    this.table = table;
    this.tokens = new Map(); // Namensbestandteil (normalisiert) → Ersatz
    this.tokenKnown = new Set();
    this.values = new Map(); // Wert (normalisiert) → Ersatz, innerhalb der Sitzung
    this.orgTokens = new Map(); // Eigenname in Organisationsnamen → Ersatz
    this.orgKnown = new Set();
  }

  kindOf(f) {
    if (f.cat === 'names') return 'name';
    if (f.cat === 'hint' && this.looksLikeName(f.value)) return 'name';
    return f.cat === 'idnumber' || f.cat === 'number' ? 'id' : f.cat;
  }

  looksLikeName(v) {
    return /^\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,3}$/u.test(v.trim()) && !/\d/.test(v);
  }

  /** Ersatzwert vorbereiten: aus der Tabelle (bekannt) oder neu erzeugt. Setzt f.fake und f.known. */
  /** Namensbestandteile bereitstellen (aus der Tabelle oder neu). Rückgabe: alle bekannt? */
  async ensureNameTokens(toks) {
    let allKnown = true;
    for (const t of toks) {
      const { key } = baseToken(t, (k) => this.tokens.has(k));
      if (!this.tokens.has(key)) {
        const hit = await this.table.lookup('name', key);
        if (hit) { this.tokens.set(key, hit.fake); this.tokenKnown.add(key); }
      }
      if (!this.tokenKnown.has(key)) allKnown = false;
    }
    for (const t of toks) {
      const { key } = baseToken(t, (k) => this.tokens.has(k));
      if (!this.tokens.has(key)) this.tokens.set(key, newNameFor(t));
    }
    return allKnown && toks.length > 0;
  }

  async prepare(f) {
    if (f.cat === 'image' || f.cat === 'manual') { f.fake = null; return; }
    if (f.cat === 'block') return this.prepareBlock(f);
    const kind = this.kindOf(f);
    if (kind === 'name') {
      const toks = [...new Set([f.value, ...f.variants].flatMap(nameTokens))];
      f.known = await this.ensureNameTokens(toks);
      f.fake = this.nameReplace(f.value);
      return;
    }
    const vkey = `${kind}|${normForHash(kind, f.value)}`;
    const hit = await this.table.lookup(kind, f.value);
    f.known = !!hit;
    // Gleicher Wert im selben Dokument (z. B. einzeln und im Adressblock) → gleicher Ersatz
    f.fake = hit ? hit.fake : this.values.get(vkey) ?? this.generate(f);
    this.values.set(vkey, f.fake);
  }

  // -------------------------------------------------------------------------
  // Blöcke (Adresse, Briefkopf, Fußzeile): Zeile für Zeile, Teil für Teil
  // -------------------------------------------------------------------------

  /** Organisationsnamen: Schlüsselwörter (GmbH, Krankenkasse …) bleiben, Eigennamen werden ersetzt. */
  async orgReplace(text, collect) {
    const out = [];
    for (const tok of text.split(/(\s+)/)) {
      const word = tok.replace(/[.,;:]+$/, '');
      const isAcronym = /^[A-ZÄÖÜ]{2,5}$/.test(word);
      const isProper = /^[A-ZÄÖÜ][a-zäöüß]{2,}(?:-[A-ZÄÖÜ][a-zäöüß]+)?$/.test(word);
      if (!word || ORG.test(word) || !(isAcronym || isProper) || FREE_KEEP.test(word)) { out.push(tok); continue; }
      const key = normalize(word);
      if (!this.orgTokens.has(key)) {
        const hit = await this.table.lookup('org', key);
        if (hit) { this.orgTokens.set(key, hit.fake); this.orgKnown.add(key); }
        else this.orgTokens.set(key, isAcronym ? Array.from({ length: word.length }, () => pick(UPPER)).join('') : pickLike(ORG_WORDS, word));
      }
      collect.org.add(key);
      out.push(tok.replace(word, this.orgTokens.get(key)));
    }
    return out.join('');
  }

  /** Text eines Blocks, der keinem erkannten Teil gehört: Namen ersetzen, Organisationsnamen ersetzen, Rest behalten. */
  async freeReplace(text, owner, collect) {
    if (!/\p{L}/u.test(text)) return text.replace(/\d+/g, (d) => (d.length >= 3 ? shapeFake(d) : d));
    if (ORG.test(text)) {
      // Nur Abschnitte mit Organisationsnamen anfassen; Beschriftungen („Bankverbindung:“) bleiben
      const pieces = text.split(/(\s[·|•]\s|,\s|[A-Za-zÄÖÜäöüß.\-]+:\s?)/);
      let out = '';
      for (const piece of pieces) out += piece && ORG.test(piece) && !/:\s?$/.test(piece) ? await this.orgReplace(piece, collect) : piece;
      return out;
    }
    const words = text.split(/[\s,]+/).filter(Boolean);
    const nameish = words.every((w) => /^\p{Lu}[\p{L}'-]*\.?$/u.test(w) || /^(und|&|u\.|c\/o|von|van|de|zu)$/i.test(w));
    if (owner !== 'person' || !nameish) return text;
    const toks = words.filter((w) => !FREE_KEEP.test(w.replace(/\.$/, '')) && /^\p{Lu}\p{Ll}+/u.test(w) && !TITLE.test(w));
    if (!toks.length) return text;
    if (!(await this.ensureNameTokens(toks))) collect.allKnown = false;
    toks.forEach((t) => collect.names.add(t));
    return this.nameReplace(text);
  }

  async prepareBlock(f, { fresh = false } = {}) {
    const collect = { names: new Set(), org: new Set(), subs: [], allKnown: true };
    f.lineFakes = new Map();
    const seen = new Set();
    for (const occ of f.occurrences) {
      if (seen.has(occ.text)) continue;
      seen.add(occ.text);
      const parts = [...(occ.parts || [])].sort((a, b) => a.start - b.start);
      let out = '', pos = 0;
      for (const p of parts) {
        if (p.start < pos) continue;
        out += await this.freeReplace(occ.text.slice(pos, p.start), f.owner, collect);
        const sub = { cat: p.cat, label: p.label || '', value: p.text, variants: [] };
        await this.prepare(sub);
        if (fresh) this.regenerate(sub);
        if (!sub.known) collect.allKnown = false;
        collect.subs.push(sub);
        out += sub.fake ?? p.text;
        pos = p.end;
      }
      out += await this.freeReplace(occ.text.slice(pos), f.owner, collect);
      f.lineFakes.set(occ.text, out);
    }
    if ([...collect.org].some((k) => !this.orgKnown.has(k))) collect.allKnown = false;
    f.subs = collect.subs;
    f.freeNames = [...collect.names];
    f.orgKeys = [...collect.org];
    f.known = collect.allKnown && (f.subs.length > 0 || f.freeNames.length > 0);
    const first = f.occurrences.filter((o, i, a) => a.findIndex((x) => x.text === o.text) === i);
    f.fake = first.map((o) => f.lineFakes.get(o.text)).join('\n');
  }

  regenerate(f) {
    if (f.cat === 'block') {
      for (const n of f.freeNames || []) { const { key } = baseToken(n, () => false); this.tokens.set(key, newNameFor(n)); this.tokenKnown.delete(key); }
      for (const k of f.orgKeys || []) { this.orgTokens.delete(k); this.orgKnown.delete(k); }
      return this.prepareBlock(f, { fresh: true });
    }
    if (this.kindOf(f) === 'name') {
      for (const t of [f.value, ...f.variants].flatMap(nameTokens)) {
        const { key } = baseToken(t, (k) => this.tokens.has(k));
        this.tokens.set(key, newNameFor(t));
        this.tokenKnown.delete(key);
      }
      f.fake = this.nameReplace(f.value);
    } else {
      f.fake = this.generate(f);
      this.values.set(`${this.kindOf(f)}|${normForHash(this.kindOf(f), f.value)}`, f.fake);
    }
    f.known = false;
  }

  nameReplace(text) {
    return text.replace(/[\p{L}][\p{L}']*/gu, (tok) => {
      if (TITLE.test(tok) || tok.length < 2) return tok;
      const { key, suffix } = baseToken(tok, (k) => this.tokens.has(k));
      const fake = this.tokens.get(key);
      return fake ? fake + suffix : tok;
    });
  }

  generate(f) {
    const v = f.value;
    const make = {
      iban: () => fakeIban(v),
      creditcard: () => fakeCard(v),
      taxid: () => (/^\d[\d ]{10,13}$/.test(v) ? fakeTaxId(v) : /^[A-Z]{2,3}\s?\d/.test(v) ? v.match(/^[A-Z]{2,3}/)[0] + shapeFake(v.replace(/^[A-Z]{2,3}/, '')) : shapeFake(v)),
      svnr: () => fakeSvnr(v),
      birthdate: () => fakeDate(v, { spreadDays: 1100 }),
      date: () => fakeDate(v, { spreadDays: 60 }),
      email: () => this.fakeEmail(v),
      phone: () => this.fakePhone(v),
      address: () => this.fakeAddress(v),
      bic: () => applyPattern(v, Array.from({ length: 4 }, () => pick(UPPER)).join('') + compactOf(v).slice(4, 6) + shapeFake(compactOf(v).slice(6))),
      url: () => (/^https?:/i.test(v) ? 'https://' : '') + (/www\./i.test(v) ? 'www.' : '') + pick(['beispiel.de', 'beispiel-seite.de', 'example.org']),
      amount: () => v.replace(/\d/g, (d, i) => (i === v.search(/\d/) && d !== '0' ? String(1 + rnd(9)) : String(rnd(10)))),
      ip: () => `10.${rnd(256)}.${rnd(256)}.${1 + rnd(254)}`,
      personal: () => (TEXTUAL_PLACES.test(f.label) ? pickLike(CITIES, v) : (v.match(/\p{L}/gu) || []).length <= 3 ? shapeFake(v) : '[anonymisiert]'),
      hint: () => (/\d/.test(v) ? shapeFake(v) : '[anonymisiert]'),
    }[f.cat] || (() => (f.label === 'Handelsregister' ? v.replace(/\d/g, () => String(rnd(10))) : shapeFake(v)));
    return differs(make, v);
  }

  fakeEmail(v) {
    const [local, domain = ''] = v.split('@');
    // Namen im vorderen Teil durch die Pseudonyme ersetzen, falls bekannt
    let fakeLocal = local.replace(/[\p{L}]+/gu, (w) => {
      const t = this.tokens.get(normalize(w));
      return t ? t.toLowerCase() : w;
    });
    if (fakeLocal === local) fakeLocal = shapeFake(local);
    fakeLocal = fakeLocal.replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c]);
    const keep = PUBLIC_MAIL_DOMAINS.has(domain.toLowerCase());
    return `${fakeLocal}@${keep ? domain : pick(FAKE_MAIL_DOMAINS)}`;
  }

  fakePhone(v) {
    const m = v.match(/^(\s*(?:\+|00)\d{1,3}[\s\-\/]*(?:\(0\)[\s\-\/]*)?|\(?0)(.*)$/s);
    if (!m) return shapeFake(v);
    return m[1] + m[2].replace(/\d/g, () => String(rnd(10))).replace(/^(\D*)0/, (all, pre) => pre + (1 + rnd(9)));
  }

  fakeAddress(v) {
    if (/^Postfach\b/i.test(v)) return v.replace(/\d/g, () => String(rnd(10))).replace(/Postfach\s+0/, 'Postfach 1');
    let m = v.match(/^(.*?)(\s?\d{1,4}.*)$/);
    if (m && /\p{L}/u.test(m[1]) && !/^\d/.test(v)) {
      // Straße + Hausnummer
      return pickLike(STREETS, m[1]) + m[2].replace(/\d+/g, (d) => String(1 + rnd(d.length > 1 ? 99 : 9)));
    }
    if ((m = v.match(/^((?:D-)?)(\d{5})(\s+)(.+)$/))) return `${m[1]}${String(10000 + rnd(89999))}${m[3]}${pickLike(CITIES, m[4])}`;
    if (/^Postfach\b/i.test(v)) return v.replace(/\d/g, () => String(rnd(10))).replace(/Postfach\s+0/, 'Postfach 1');
    return shapeFake(v);
  }

  /** Ersatztext für ein einzelnes Vorkommen (Formatierung des Vorkommens bleibt erhalten). */
  fakeFor(f, occText) {
    if (f.cat === 'block') return f.lineFakes?.get(occText) ?? occText;
    if (this.kindOf(f) === 'name') return this.nameReplace(occText);
    if (occText === f.value || !f.fake) return f.fake;
    const a = compactOf(occText), b = compactOf(f.value);
    if (a.toUpperCase() === b.toUpperCase()) return applyPattern(occText, compactOf(f.fake));
    return f.fake;
  }

  /** Ersatzwerte der gewählten Funde dauerhaft in der Tabelle speichern. */
  async commit(findings) {
    for (const f of findings) {
      if (f.action !== 'replace' || !f.fake) continue;
      if (f.cat === 'block') {
        await this.commit((f.subs || []).map((sub) => ({ ...sub, action: 'replace' })));
        for (const n of f.freeNames || []) {
          const { key } = baseToken(n, (k) => this.tokens.has(k));
          if (this.tokens.has(key)) await this.table.remember('name', key, this.tokens.get(key), 'Name');
        }
        for (const k of f.orgKeys || []) if (this.orgTokens.has(k)) await this.table.remember('org', k, this.orgTokens.get(k), 'Organisation');
        continue;
      }
      const kind = this.kindOf(f);
      if (kind === 'name') {
        for (const t of [f.value, ...f.variants].flatMap(nameTokens)) {
          const { key } = baseToken(t, (k) => this.tokens.has(k));
          if (this.tokens.has(key)) await this.table.remember('name', key, this.tokens.get(key), 'Name');
        }
      } else await this.table.remember(kind, f.value, f.fake, f.label);
    }
  }
}
