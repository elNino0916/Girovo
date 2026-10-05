'use strict';

// What telemetry may carry, decided in one place (electron/telemetry.cjs sends
// only what passes through here).
//
// Nothing about the user's money leaves the machine: no IBAN, balance,
// booking, amount, payee, Verwendungszweck, login name or PIN. Two kinds of
// input need care:
//
//   free text  error messages and stacks. Most are the code's own words, but a
//              message can quote what a bank said, and a bank's text can name
//              a person (the Namensabgleich does) or carry an amount. text()
//              masks everything that looks like one of those.
//   fields     event properties. Only fields an event declares in its spec are
//              kept, and each must match its type exactly — so no free text
//              can ride along in a property.
//
// Everything here is pure, so electron/telemetry-scrub.test.cjs can pin it.

const MAX_MESSAGE = 300;
const MAX_FRAMES = 30;

const RULES = [
  // A URL keeps its origin and path; query and fragment can carry anything.
  // A stack frame's ":line:col" after the query stays.
  [/(\b(?:https?|file):\/\/[^\s?#'"<>]*)[?#][^\s'"<>()]*?(?=(?::\d+){1,2}(?=[\s)'"<>]|$)|[\s)'"<>]|$)/gi, '$1'],
  // Home folders name the person using the machine.
  [/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s'"<>:]+/gi, '$1~'],
  [/(\/(?:Users|home)\/)[^/\s'"<>:]+/g, '$1~'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[E-Mail]'],
  // IBAN, with or without its groups of four.
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, '[IBAN]'],
  // What follows a label that introduces a person or a booking's text.
  [/\b(Empfänger(?:name)?|Zahlungsempfänger|Auftraggeber|Kontoinhaber(?:in)?|Inhaber(?:in)?|Name|Verwendungszweck|Begünstigter|Payee|Recipient|Creditor|Debtor)(\s*[:=]?\s*)[^\n.;]{1,120}/gi, '$1$2[…]'],
  // Text in quotes, unless it is a single code word ('amount', "fetchFromBank").
  [/"([^"\n]{1,200})"|'([^'\n]{1,200})'|„([^“”\n]{1,200})[“”]|«([^»\n]{1,200})»|‚([^‘’\n]{1,200})[‘’]/g,
    (whole, ...groups) => (/^[A-Za-z_$][\w$.]{0,60}$/.test(groups.find((g) => g !== undefined) ?? '') ? whole : '"…"')],
  // Dates: a booking date is part of a booking.
  [/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b|\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, '[Datum]'],
  // Amounts: "1.234,56", "49,99", "49.99 EUR".
  [/\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b|\b\d+[.,]\d{2}\b/g, '[Betrag]'],
  // Long numbers: account numbers, BLZ, references. Short ones (an HTTP
  // status, a FinTS return code like 9942) stay — they say what went wrong.
  [/\d{5,}/g, '[Zahl]'],
];

/** `value` as one line of text with everything personal masked, at most `max` characters. */
function text(value, max = MAX_MESSAGE) {
  let s = String(value ?? '').slice(0, 4000);
  for (const [pattern, replacement] of RULES) s = s.replace(pattern, replacement);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A stack frame's location: folders and URLs masked, line and column kept. */
function frame(line) {
  let s = line.trim().slice(0, 400);
  for (const [pattern, replacement] of RULES.slice(0, 3)) s = s.replace(pattern, replacement);
  return s;
}

const ERROR_NAME = /^[A-Za-z_$][\w$]{0,40}$/;

/**
 * An error made safe to send: its class name, the message through text(),
 * and only the stack's "at …" frames (the stack's first lines repeat the raw
 * message, so they are rebuilt from the scrubbed one). Accepts an Error, an
 * object shaped like one (from the renderer or the server), or anything else.
 */
function error(raw) {
  if (raw === undefined || raw === null) return null;
  const isObject = typeof raw === 'object';
  const name = isObject && typeof raw.name === 'string' && ERROR_NAME.test(raw.name) ? raw.name : 'Error';
  const rawMessage = isObject ? (typeof raw.message === 'string' ? raw.message : '') : String(raw);
  const message = text(rawMessage);
  const frames = isObject && typeof raw.stack === 'string'
    ? raw.stack.split('\n').filter((l) => /^\s*at\s/.test(l)).slice(0, MAX_FRAMES).map(frame)
    : [];
  const out = new Error(message);
  out.name = name;
  out.stack = [`${name}: ${message}`, ...frames.map((f) => `    ${f}`)].join('\n');
  return out;
}

const TYPES = {
  bool: (v) => (typeof v === 'boolean' ? v : undefined),
  int: (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1e9, Math.round(v))) : undefined),
  blz: (v) => (typeof v === 'string' && /^\d{8}$/.test(v) ? v : undefined),
  version: (v) => (typeof v === 'string' && /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[\w.]{1,32})?$/.test(v) ? v : undefined),
  // A code word: a route, a screen, a TAN method's id. Never a sentence.
  id: (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:/-]{1,64}$/.test(v) ? v : undefined),
};

/**
 * Only the fields `spec` declares, each of its type. A spec value is a type
 * name ('bool', 'int', 'blz', 'version', 'id') or an array of allowed values.
 */
function props(raw, spec) {
  const out = {};
  if (!raw || typeof raw !== 'object' || !spec) return out;
  for (const [key, type] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = raw[key];
    const kept = Array.isArray(type) ? (type.includes(value) ? value : undefined) : TYPES[type]?.(value);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

module.exports = { text, error, props, MAX_MESSAGE };
