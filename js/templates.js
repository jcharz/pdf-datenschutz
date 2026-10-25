// Bearbeitungsschablonen: Die App merkt sich, wie ein Dokumenttyp (z. B. die Abrechnung einer Krankenkasse)
// bearbeitet wurde, erkennt dasselbe Formular später wieder und kann alle Schritte auf einmal anwenden.
//
// Datenschutz: Schablonen enthalten keine Inhalte des Dokuments. Gespeichert werden nur gesalzene
// Fingerabdrücke der festen Formulartexte („Versichertennummer:“, „Leistungsabrechnung“ …), die
// Entscheidungen je Feldtyp, markierte Flächen als relative Position und Hinweise als Fingerabdruck.

import { normalize } from './detect.js';

const KEY = 'pdfprivacy.templates';
const MAX_PAGES = 3;

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Text einer Zeile ohne die gefundenen Werte und ohne Ziffern – das, was bei jedem Exemplar gleich ist. */
function maskedLine(model, line, ranges) {
  let out = '';
  for (let i = line.start; i < line.end; i++) out += ranges.some(([s, e]) => i >= s && i < e) ? '@' : model.text[i];
  return normalize(out.replace(/@+/g, ' @ ').replace(/\d/g, '#')).replace(/#+/g, '#');
}

function rangesByPage(findings) {
  const map = new Map();
  for (const f of findings) {
    for (const o of f.occurrences) {
      if (o.start === undefined) continue;
      if (!map.has(o.page)) map.set(o.page, []);
      map.get(o.page).push([o.start, o.end]);
    }
  }
  return map;
}

/** Strukturelle Fingerabdrücke der festen Formulartexte. */
export async function fingerprint(models, findings, salt) {
  const ranges = rangesByPage(findings);
  const out = new Set();
  for (let p = 0; p < Math.min(MAX_PAGES, models.length); p++) {
    for (const l of models[p].lines || []) {
      const t = maskedLine(models[p], l, ranges.get(p) || []);
      if ((t.match(/[a-z]/g) || []).length < 4) continue;
      out.add(await sha(`${salt}|fp|${t}`));
    }
  }
  return [...out];
}

/** Merkmal eines Funds, das in jedem Exemplar des Formulars gleich ist (Kategorie, Bezeichnung, Textumgebung). */
export async function findingSignature(f, models, salt) {
  const o = f.occurrences[0];
  if (!o) return null;
  if (f.cat === 'manual' || f.cat === 'image') {
    return sha(`${salt}|sig|${f.cat}|${o.page}|${o.quads?.[0]?.map((p) => p.map((v) => Math.round(v / 20)).join(':')).join(';')}`);
  }
  const model = models[o.page];
  const line = model?.lines?.find((l) => l.start <= o.start && o.start < l.end);
  const before = line ? normalize(model.text.slice(line.start, o.start).replace(/\d/g, '#')).slice(-40) : '';
  return sha(`${salt}|sig|${f.cat}|${f.label}|${before}`);
}

export const typeKey = (f) => `${f.cat}|${f.owner || 'person'}|${f.label}`;

function similarity(a, b) {
  const A = new Set(a);
  let both = 0;
  for (const x of b) if (A.has(x)) both++;
  return { both, score: both / Math.max(1, Math.min(A.size, b.length)) };
}

export class TemplateStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    try { this.items = JSON.parse(storage?.getItem(KEY) || '[]'); } catch { this.items = []; }
  }

  save() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.items)); } catch { /* Speicher voll oder privat */ }
  }

  list() { return [...this.items].sort((a, b) => b.used - a.used); }
  get(id) { return this.items.find((t) => t.id === id); }
  remove(id) { this.items = this.items.filter((t) => t.id !== id); this.save(); }
  clear() { this.items = []; this.save(); }

  /** Beste passende Schablone (mindestens 60 % der festen Texte gleich). */
  match(fp) {
    let best = null;
    for (const t of this.items) {
      const { both, score } = similarity(t.fp, fp);
      if (both >= 4 && score >= 0.6 && (!best || score > best.score)) best = { template: t, score };
    }
    return best;
  }

  /**
   * Schablone aus der aktuellen Bearbeitung erstellen bzw. aktualisieren.
   * data: { name, fp, findings (mit sig), hints, salt }
   */
  upsert({ id, name, fp, findings, hints }) {
    const rules = {}, types = {}, baseRules = {};
    const votes = {}, baseVotes = {};
    const vote = (store, k, f) => { store[k] = store[k] || {}; store[k][f.action] = (store[k][f.action] || 0) + 1; };
    const winner = (v) => Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
    for (const f of findings) {
      if (f.cat === 'manual') continue;
      if (f.sig) rules[f.sig] = { action: f.action, owner: f.owner || 'person' };
      if (f.sigBase) vote(baseVotes, f.sigBase, f);
      vote(votes, typeKey(f), f);
    }
    for (const [k, v] of Object.entries(votes)) types[k] = winner(v);
    for (const [k, v] of Object.entries(baseVotes)) {
      const owner = findings.find((f) => f.sigBase === k)?.owner || 'person';
      baseRules[k] = { action: winner(v), owner };
    }
    const areas = findings.filter((f) => f.cat === 'manual' && f.action !== 'keep').map((f) => ({ page: f.occurrences[0].page, rel: f.rel }));
    const now = Date.now();
    const prev = id && this.get(id);
    const t = {
      id: prev?.id || `t${now.toString(36)}`, name, created: prev?.created || now, used: now, uses: (prev?.uses || 0) + 1,
      fp, rules, baseRules, types, areas, hints,
    };
    this.items = this.items.filter((x) => x.id !== t.id).concat(t);
    this.save();
    return t;
  }

  touch(id) {
    const t = this.get(id);
    if (t) { t.used = Date.now(); t.uses = (t.uses || 0) + 1; this.save(); }
  }

  import(list) {
    if (!Array.isArray(list)) return;
    const ids = new Set(this.items.map((t) => t.id));
    this.items.push(...list.filter((t) => t?.id && Array.isArray(t.fp) && !ids.has(t.id)));
    this.save();
  }
}

/** Fingerabdruck eines Hinweisbegriffs (der Begriff selbst wird nicht gespeichert). */
export function hintHash(term, salt) {
  return sha(`${salt}|hint|${normalize(term)}`);
}

/** Sucht Begriffe, deren Fingerabdruck in der Schablone steht. Rückgabe: [{page, start, end, text}] */
export async function findHashedTerms(texts, hashes, salt) {
  const want = new Map(hashes.map((h) => [h.hash, h]));
  const sizes = [...new Set(hashes.map((h) => h.words))];
  const out = [];
  for (let page = 0; page < texts.length; page++) {
    const toks = [...texts[page].matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.\-]*/gu)];
    for (let i = 0; i < toks.length; i++) {
      for (const n of sizes) {
        if (i + n > toks.length) continue;
        const span = toks.slice(i, i + n);
        const text = texts[page].slice(span[0].index, span[n - 1].index + span[n - 1][0].length);
        if (n > 1 && text.includes('\n')) continue;
        const h = await sha(`${salt}|hint|${normalize(text)}`);
        if (want.has(h)) out.push({ page, start: span[0].index, end: span[0].index + text.length, text, keep: want.get(h).keep });
      }
    }
  }
  return out;
}
