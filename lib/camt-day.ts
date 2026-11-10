// The Buchungstag of a camt booking, as the bank wrote it.
//
// lib-fints' CamtParser turns the bank's date text into a Date: a bare
// "2026-07-22" into that day's local noon, "2026-07-22+02:00" or a date-time
// into the moment it names. The Date alone no longer tells the two apart: at
// UTC-10 the second is local noon of the 21st, exactly like a bare
// "2026-07-21". So the parser's date method is wrapped here, once, to
// remember the text each Date came from; the bank's day is that text's own
// date part (lib/serialize.ts, before lib/format.ts statedDay works it out
// from the moment).
//
// Server-side, like the parser. A Date the parser did not make here, or one
// changed afterwards (a new object), has no text: the caller falls back.

import { CamtParser } from './fints-internals.js';

const texts = new WeakMap<Date, string>();

type Parse = (this: unknown, text: string) => unknown;
const proto = (CamtParser as unknown as { prototype: { parseDate?: Parse & { girovoTexts?: true } } }).prototype;
const parse = proto.parseDate;
if (typeof parse === 'function' && !parse.girovoTexts) {
  const wrapped: Parse & { girovoTexts?: true } = function (this: unknown, text: string) {
    const d = parse.call(this, text);
    if (d instanceof Date && typeof text === 'string') texts.set(d, text.trim());
    return d;
  };
  wrapped.girovoTexts = true;
  proto.parseDate = wrapped;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;

/** The day the bank wrote for a Date the camt parser made, yyyy-mm-dd; '' when it did not make it. */
export function camtDay(d: unknown): string {
  if (!(d instanceof Date)) return '';
  const text = texts.get(d);
  const m = text ? DATE.exec(text) ?? COMPACT.exec(text) : null;
  if (!m) return '';
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  const check = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return check.getUTCMonth() === +m[2] - 1 && check.getUTCDate() === +m[3] ? day : '';
}
