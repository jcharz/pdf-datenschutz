// Seitenlayout auswerten: Zeilen zu Blöcken zusammenfassen, Werte unter/neben Beschriftungen finden,
// Absender- und eigene Daten unterscheiden und Adressen als ganzen Block behandeln.
// Reine Funktionen auf dem Textmodell – laufen im Browser und in Node (Tests).

import {
  scanCandidates, claimCandidates, groupOccurrences, sortFindings, PRIO, PERSONAL_LABELS, normalize, valueKey,
} from './detect.js';

// ---------------------------------------------------------------------------
// Erkennungsmuster
// ---------------------------------------------------------------------------

export const ORG = /(?<![\p{L}])(GmbH|AG|KG|OHG|KGaA|e\.\s?V\.|eG|mbH|SE|UG|Versicherung\p{L}*|\p{L}*[Kk]asse|Bank|Sparkasse|Volksbank|Praxis|Klinik\p{L}*|Krankenhaus|Kanzlei|\p{L}*[Aa]mt|Behörde|Stadt|Gemeinde|\p{L}*[Vv]erwaltung|Universität|Hochschule|Institut|Stiftung|Verband|Agentur|Bundes\p{L}+|Landes\p{L}+|Service|Zentrale|Hauptverwaltung|Geschäftsstelle|Rechtsanw\p{L}+|Steuerberat\p{L}*|Gesellschaft|Gruppe|Holding|Meisterbetrieb|Elektro|Sanitär|Apotheke)(?![\p{L}])/u;
const SENDER_LABEL = /(?<![\p{L}])(Ansprechpartner\p{L}*|Sachbearbeit\p{L}*|Bearbeiter\p{L}*|Ihr Kontakt|Kontaktperson|Durchwahl|Zentrale|Service\p{L}*|Hotline|Unser Zeichen|Geschäftsführ\p{L}*|Vorstand|Vorsitz\p{L}*|Registergericht|Amtsgericht|Handelsregister|Umsatzsteuer\p{L}*|Bankverbindung|Gläubiger\p{L}*|Sitz der)(?![\p{L}])|(?<![\p{L}])USt(?![a-z])/iu;
const PERSON_LABEL = /(?<![\p{L}])(Ihre?[ \t]|Versichert\p{L}*|Patient\p{L}*|Kontoinhaber\p{L}*|Kunde|Kundin|Kunden\p{L}*|Mitglied\p{L}*|Antragsteller\p{L}*|geb\.|geboren|Empfänger\p{L}*|Mieter\p{L}*|Schuldner\p{L}*|Anschrift|Wohnort|wohnhaft|Leistungsort)/iu;
const GENERIC_MAIL = /^(info|service|kontakt|post|poststelle|mail|office|noreply|no-reply|support|kundenservice|hotline|praxis|team|buchhaltung|rechnung|verwaltung|zentrale|hello|hallo|presse|bewerbung|datenschutz)[@.]/i;
const PLZ_LINE = /^(?:D-)?\d{5}[ \t]+\p{Lu}/u;
const POSTFACH = /^Postfach\b/i;
const SALUTATION = /^(Herrn?|Frau|Familie|Firma|Eheleute|An(?: die| den| das)?|z\.\s?Hd\.?)(?![\p{L}])/u;
const CLOSING = /(Mit (?:\p{L}+ ){0,2}Grüßen|Viele Grüße|Beste Grüße|Freundliche Grüße|Herzliche Grüße|Hochachtungsvoll)/u;
const CONTACT_LINE = /^(Tel\.?|Telefon|Fax|Telefax|Mobil|Handy|E-?Mail|Mail|Internet|Web|www\.|http)/i;
const COUNTRY = /^(Deutschland|Germany|Österreich|Schweiz|DE|D)$/;

// Beschriftungen, deren Wert in der Zeile darunter oder rechts daneben steht (Formulare, Infoblöcke)
const LABEL_CATS = [
  [/^(name|vorname|nachname|familienname|geburtsname|name,? ?vorname|vorname,? ?name|nachname,? ?vorname|vor- und (zu|nach)name|kontoinhaber(in)?|versicherte[rn]?|patient(in)?|antragsteller(in)?|empfänger(in)?|mieter(in)?|ehepartner(in)?)$/i, 'names'],
  [/^(straße|strasse|straße,? ?(haus)?nr\.?|straße,? ?hausnummer|straße und hausnummer|anschrift|adresse|wohnanschrift|wohnadresse)$/i, 'address'],
  [/^(plz|postleitzahl|plz,? ?ort|postleitzahl,? ?ort|wohnort)$/i, 'address'],
  [/^(geburtsdatum|geb\.?-?datum|geboren am|geburtstag)$/i, 'birthdate'],
  [/^(telefon|tel\.?|telefonnummer|mobil|mobilnummer|handy|fax)$/i, 'phone'],
  [/^(e-?mail|e-?mail-adresse)$/i, 'email'],
  [/^iban$/i, 'iban'],
  [/^(bic|swift|bic\/swift)$/i, 'bic'],
  [new RegExp(`^(${PERSONAL_LABELS})$`, 'i'), 'personal'],
  [/(nummer|nr\.?|kennung|kennzeichen|aktenzeichen|zeichen|-id|identifikationsnummer)$/i, 'idnumber'],
];
const VALID = {
  names: (v) => /\p{L}{2}/u.test(v) && !/\d/.test(v) && v.split(/\s+/).length <= 5,
  address: (v) => /\p{L}{2}/u.test(v),
  birthdate: (v) => /\d/.test(v),
  phone: (v) => (v.match(/\d/g) || []).length >= 6,
  email: (v) => v.includes('@'),
  iban: (v) => /^[A-Z]{2}\d{2}/.test(v.replace(/\s/g, '')),
  bic: (v) => /^[A-Z]{6}[A-Z0-9]{2,5}$/.test(v.replace(/\s/g, '')),
  personal: (v) => v.length >= 2,
  idnumber: (v) => /\d/.test(v),
};

function labelCat(text) {
  const t = text.replace(/[:*]+$/, '').trim();
  if (t.length > 40 || /\d/.test(t)) return null;
  for (const [rx, cat] of LABEL_CATS) if (rx.test(t)) return { cat, label: t };
  return null;
}

// ---------------------------------------------------------------------------
// Layout: Zeilen → Blöcke
// ---------------------------------------------------------------------------

/** Untereinander stehende, linksbündige Zeilen gleicher Schriftgröße bilden einen Block. */
export function layoutBlocks(model) {
  const lines = model.lines.filter((l) => l.x0 !== null).sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const blocks = [];
  for (const l of lines) {
    let best = null, bestDy = Infinity;
    for (const b of blocks) {
      const last = b.lines[b.lines.length - 1];
      const dy = l.y - last.y;
      const tol = Math.max(4, 0.8 * Math.min(l.size, last.size));
      if (Math.abs(l.x0 - last.x0) <= tol && dy > 0.3 * l.size && dy <= 2.2 * Math.max(l.size, last.size)
        && Math.abs(l.size - last.size) <= 2.5 && dy < bestDy) { best = b; bestDy = dy; }
    }
    if (best) best.lines.push(l); else blocks.push({ lines: [l] });
    l.block = best || blocks[blocks.length - 1];
  }
  return blocks;
}

function lineAt(model, pos) {
  return model.lines.find((l) => l.start <= pos && pos < l.end) || null;
}

const zone = (model, l) => (l?.y == null ? 'body' : l.y > model.height * 0.88 ? 'footer' : l.y < model.height * 0.13 ? 'header' : 'body');

// ---------------------------------------------------------------------------
// Werte unter/neben Beschriftungen
// ---------------------------------------------------------------------------

function layoutCandidates(model, page) {
  const out = [];
  const geo = model.lines.filter((l) => l.x0 !== null);
  for (const l of geo) {
    const lc = labelCat(l.text);
    if (!lc) continue;
    const right = geo.filter((v) => v !== l && Math.abs(v.y - l.y) <= 0.35 * l.size && v.x0 > l.x1 && v.x0 - l.x1 < 220)
      .sort((a, b) => a.x0 - b.x0)[0];
    const below = geo.filter((v) => v !== l && v.x0 >= l.x0 - 6 && v.x0 <= l.x0 + 30 && v.y - l.y > 0.3 * l.size
      && v.y - l.y <= 2.4 * Math.max(l.size, v.size)).sort((a, b) => a.y - b.y)[0];
    for (const v of [right, below]) {
      if (!v || labelCat(v.text) || !VALID[lc.cat](v.text) || v.text.length > 90) continue;
      out.push({ page, start: v.start, end: v.end, text: v.text, cat: lc.cat, label: lc.label, prio: PRIO[lc.cat] });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wem gehören die Daten?
// ---------------------------------------------------------------------------

/** Belege dafür, dass ein Layoutblock vom Absender stammt (Organisation, Sammel-E-Mail, Webadresse). */
function senderEvidence(lines) {
  return lines.some((x) => ORG.test(x.text) || /(?:^|[\s:])(?:info|service|kontakt|post|poststelle|praxis|office|zentrale)@|www\.|https?:\/\//i.test(x.text));
}

/** Briefkopf: Organisationszeile oben auf der Seite in der Nähe (z. B. „Praxis Dr. Weber“ über der Adresszeile). */
function letterheadNear(model, L) {
  return model.lines.some((x) => x.x0 !== null && x.y < model.height * 0.2 && Math.abs(x.y - L.y) <= 40
    && ORG.test(x.text) && !SALUTATION.test(x.text));
}

/** Hat das Dokument einen Absender, der eine Organisation ist (Briefkopf, Fußzeile, Absenderzeile)? */
function orgDocument(model) {
  return model.lines.some((x) => x.x0 !== null && (x.y < model.height * 0.2 || (x.y > model.height * 0.88 && x.size <= 9))
    && ORG.test(x.text) && !SALUTATION.test(x.text)
    // Organisation als Empfänger (Adressblock mit „Herrn …“) zählt nicht als Briefkopf
    && !(x.block?.lines || []).some((y) => SALUTATION.test(y.text)));
}

// Im Zweifel gehören Daten zur Person: „Absender“ nur bei klaren Belegen – sonst würden sie standardmäßig stehen bleiben.
// Rückgabe: { owner, strong } – strong = ausdrücklicher Beleg (Beschriftung, Anrede, Fußzeile).
function ownerOf(c, model) {
  const L = lineAt(model, c.start);
  if (!L || L.x0 === null) return { owner: 'person', strong: false };
  const z = zone(model, L);
  const sender = (strong = false) => ({ owner: 'sender', strong });
  const person = (strong = false) => ({ owner: 'person', strong });
  if (z === 'footer' && L.size <= 9) return sender(true);
  // Beschriftung links in derselben Zeile (Tabellen: „Telefon | 040 …“) zählt mit
  const rowLabel = model.lines.filter((x) => x !== L && x.x0 !== null && Math.abs(x.y - L.y) <= 0.35 * L.size
    && x.x1 <= L.x0 + 1 && L.x0 - x.x1 < 220).sort((a, b) => b.x1 - a.x1)[0];
  const before = (rowLabel ? `${rowLabel.text} ` : '') + model.text.slice(L.start, c.start);
  if (SENDER_LABEL.test(before)) return sender(true);
  if (PERSON_LABEL.test(before) || SALUTATION.test(before.trim())) return person(true);
  const blockLines = [...(L.block?.lines || [L]), ...(rowLabel?.block?.lines || [])];
  if (blockLines.some((x) => SALUTATION.test(x.text)) && !ORG.test(blockLines[0].text)) return person(true);
  if (z === 'header' && (senderEvidence(blockLines) || letterheadNear(model, L))) return sender();
  if (L.size <= 7.5 && /[·|•,]/.test(L.text) && L.y < model.height * 0.3) return sender(); // Absenderzeile im Adressfenster
  if (c.cat === 'email' && GENERIC_MAIL.test(c.text)) return sender();
  if (c.cat === 'url') return sender();
  if (c.cat === 'phone' && /^(?:\+49|0049)?\s?0?(?:800|180\d?|900)/.test(c.text.replace(/[^\d+]/g, ''))) return sender();
  if (['phone', 'email', 'url', 'names'].includes(c.cat)
    && blockLines.some((x) => x !== L && /Ansprechpartner|Sachbearbeit|Bearbeiter|Kontaktperson/i.test(x.text))) return sender();
  // Unterschrift unter einem Brief einer Organisation (bei Privatbriefen ist der Absender die Person selbst)
  if (c.cat === 'names' && CLOSING.test(model.text.slice(Math.max(0, c.start - 140), c.start)) && orgDocument(model)) return sender();
  if (['address', 'phone', 'email', 'names', 'url'].includes(c.cat) && ORG.test(L.text) && !SALUTATION.test(L.text)) return sender();
  return person();
}

// ---------------------------------------------------------------------------
// Adress- und Absenderblöcke
// ---------------------------------------------------------------------------

function addressish(l, ref) {
  const words = l.text.split(/\s+/).length;
  return words <= 8 && !/:\s*$/.test(l.text) && !/[.!?]$/.test(l.text.replace(/\b(?:Str|Dr|med|Prof|Nr)\.$/, ''))
    && Math.abs(l.size - ref.size) <= 2.5 && !CLOSING.test(l.text) && !/^(Sehr geehrte|Liebe|Hallo|Guten Tag)/.test(l.text);
}

function blockOwner(lines, model) {
  const first = lines[0];
  if (zone(model, first) === 'footer' && first.size <= 9) return 'sender';
  if (ORG.test(first.text) && !SALUTATION.test(first.text)) return 'sender'; // „Hausverwaltung X / Herrn Y / …“
  if (lines.some((l) => SALUTATION.test(l.text))) return 'person';
  if (first.size <= 7.5 && lines.length === 1 && /[·|•,]/.test(first.text)) return 'sender'; // Absenderzeile
  if (senderEvidence(lines) || senderEvidence(first.block?.lines || [])) return 'sender';
  if (zone(model, first) === 'header' && letterheadNear(model, first)) return 'sender';
  return 'person';
}

function blockLabel(owner, lines, model, inline) {
  if (zone(model, lines[0]) === 'footer') return 'Fußzeile';
  if (owner === 'person') return inline ? 'Adresse' : 'Adressblock';
  if (inline && lines[0].size > 8 && !/\s[·|•]\s/.test(lines[0].text)) return 'Adresse (Organisation)';
  if (lines.length === 1 && lines[0].size <= 7.5) return 'Absenderzeile';
  if (zone(model, lines[0]) === 'header') return 'Briefkopf';
  return 'Absenderadresse';
}

/** Findet Adressblöcke (mehrzeilig oder in einer Zeile) und die Fußzeile einer Seite. Rückgabe: [{lines, ranges}] */
function findBlocks(model, cands) {
  const blocks = [];
  const used = new Set();
  const candsIn = (s, e) => cands.filter((c) => c.start >= s && c.end <= e);

  // 1. Fußzeile: alle kleinen Zeilen unten mit Funden
  const foot = model.lines.filter((l) => l.x0 !== null && zone(model, l) === 'footer' && l.size <= 9 && candsIn(l.start, l.end).length);
  if (foot.length) {
    foot.forEach((l) => used.add(l));
    blocks.push({ lines: foot, ranges: foot.map((l) => [l.start, l.end]) });
  }

  // 2. Mehrzeilige Adressblöcke rund um „PLZ Ort“ bzw. „Postfach“
  for (const b of model.blocks || layoutBlocks(model)) {
    const ls = b.lines;
    for (let p = 0; p < ls.length; p++) {
      if (used.has(ls[p]) || !(PLZ_LINE.test(ls[p].text) || POSTFACH.test(ls[p].text))) continue;
      let up = p;
      while (up > 0 && p - up < 5 && !used.has(ls[up - 1]) && addressish(ls[up - 1], ls[p])) up--;
      let down = p;
      while (down + 1 < ls.length && !used.has(ls[down + 1])
        && (CONTACT_LINE.test(ls[down + 1].text) || COUNTRY.test(ls[down + 1].text) || PLZ_LINE.test(ls[down + 1].text)
          || candsIn(ls[down + 1].start, ls[down + 1].end).some((c) => ['phone', 'email', 'url'].includes(c.cat)))) down++;
      if (up === p && down === p) continue; // nur „PLZ Ort“ allein → kein Block
      const lines = ls.slice(up, down + 1);
      lines.forEach((l) => used.add(l));
      blocks.push({ lines, ranges: lines.map((l) => [l.start, l.end]) });
      p = down;
    }
  }

  // 3. Adresse in einer Zeile: „Firma · Straße 1 · 12345 Ort“ oder „Anschrift: Straße 1, 12345 Ort“
  for (const l of model.lines) {
    if (used.has(l) || l.x0 === null) continue;
    const inLine = candsIn(l.start, l.end);
    const plz = inLine.find((c) => c.cat === 'address' && PLZ_LINE.test(c.text));
    const street = inLine.find((c) => c.cat === 'address' && c !== plz && c.start < (plz?.start ?? -1));
    if (!plz || !street) continue;
    // Ganze Zeile nur bei reinen Adresszeilen („Firma · Straße 1 · 12345 Ort“), sonst nur „Straße … Ort“ (Fließtext)
    const pureLine = /\s[·|•]\s/.test(l.text) || l.size <= 8;
    const range = pureLine && !/:\s*$/.test(model.text.slice(l.start, street.start)) ? [l.start, l.end] : [street.start, plz.end];
    used.add(l);
    blocks.push({ lines: [l], ranges: [range], inline: true });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Gesamtanalyse
// ---------------------------------------------------------------------------

/**
 * Analysiert alle Seiten: Text-Funde + Layout-Funde, Zuordnung (person/sender), Blöcke.
 * models: [{ text, lines, width, height }]. Rückgabe: Funde wie scanDocument, zusätzlich owner und Blöcke (cat 'block').
 */
export function analyzeDocument(models) {
  const texts = models.map((m) => m.text);
  const cands = scanCandidates(texts);
  models.forEach((m, page) => { if (m.lines) cands.push(...layoutCandidates(m, page)); });
  models.forEach((m) => { if (m.lines) m.blocks = layoutBlocks(m); });
  const claimed = claimCandidates(cands, models.length);
  for (const c of claimed) {
    const o = models[c.page].lines ? ownerOf(c, models[c.page]) : { owner: 'person', strong: false };
    c.owner = o.owner;
    c.strongOwner = o.strong;
  }
  // Gleicher Wert an mehreren Stellen: ausdrücklicher Beleg gilt für alle Stellen (Person hat Vorrang)
  const byValue = new Map();
  for (const c of claimed) {
    const k = valueKey(c.cat, c.text);
    if (!byValue.has(k)) byValue.set(k, []);
    byValue.get(k).push(c);
  }
  for (const list of byValue.values()) {
    const strong = list.filter((c) => c.strongOwner);
    const owner = strong.some((c) => c.owner === 'person') ? 'person' : strong.length ? 'sender' : null;
    if (owner) for (const c of list) c.owner = owner;
  }

  const blockGroups = new Map();
  const absorbed = new Set();
  models.forEach((model, page) => {
    if (!model.lines) return;
    const pageCands = claimed.filter((c) => c.page === page);
    for (const b of findBlocks(model, pageCands)) {
      // Einzeilige Adresse: Zuordnung wie ihre Teile (Kontext der Zeile); im Zweifel Person
      const partsIn = pageCands.filter((c) => b.ranges.some(([s, e]) => c.start >= s && c.end <= e));
      const owner = b.inline ? (partsIn.some((c) => c.owner === 'person') ? 'person' : 'sender') : blockOwner(b.lines, model);
      const inside = [];
      const occurrences = b.ranges.map(([s, e]) => {
        const parts = pageCands.filter((c) => c.start >= s && c.end <= e);
        inside.push(...parts);
        return { page, start: s, end: e, text: model.text.slice(s, e), parts: parts.map((c) => ({ cat: c.cat, label: c.label, start: c.start - s, end: c.end - s, text: c.text })) };
      });
      if (!inside.length) continue; // nur Blöcke, in denen wirklich etwas steckt
      inside.forEach((c) => absorbed.add(c));
      const value = occurrences.map((o) => o.text.replace(/\s+/g, ' ').trim()).join('\n');
      const key = `block|${owner}|${normalize(value)}`;
      if (!blockGroups.has(key)) {
        const label = blockLabel(owner, b.lines, model, b.inline);
        blockGroups.set(key, {
          key, cat: 'block', label, owner, value, variants: [],
          risk: owner === 'person' ? 'hoch' : 'niedrig', occurrences: [], instances: 0,
        });
      }
      const g = blockGroups.get(key);
      g.occurrences.push(...occurrences);
      g.instances++;
    }
  });

  const rest = claimed.filter((c) => !absorbed.has(c));
  return sortFindings([...blockGroups.values(), ...groupOccurrences(rest)]);
}
