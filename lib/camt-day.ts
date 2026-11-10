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
// The texts are kept on the wrapper itself, which sits on the parser's
// prototype: a second instance of this module (a duplicate in a bundle, a
// module evaluated again) finds the wrapper already there and reads the same
// texts, rather than wrapping twice or finding none.
//
// Server-side, like the parser. A Date the parser did not make, or a copy of
// one (a new object: structuredClone, JSON), has no text: the caller falls
// back to the moment.

import { CamtParser } from './fints-internals.js';

type Parse = ((this: unknown, text: string) => unknown) & { girovoTexts?: WeakMap<Date, string> };
const proto = (CamtParser as unknown as { prototype: { parseDate?: Parse } }).prototype;

/** The wrapper's texts, the wrapper put in place first where it is not there yet. */
function textsOf(): WeakMap<Date, string> | undefined {
  const current = proto.parseDate;
  if (typeof current !== 'function') return undefined;
  if (current.girovoTexts) return current.girovoTexts;
  const texts = new WeakMap<Date, string>();
  const wrapped: Parse = function (this: unknown, text: string) {
    const d = current.call(this, text);
    if (d instanceof Date && typeof text === 'string') texts.set(d, text.trim());
    return d;
  };
  wrapped.girovoTexts = texts;
  proto.parseDate = wrapped;
  return texts;
}
textsOf();

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;

/** The day the bank wrote for a Date the camt parser made, yyyy-mm-dd; '' when it did not make it. */
export function camtDay(d: unknown): string {
  if (!(d instanceof Date)) return '';
  const text = textsOf()?.get(d);
  const m = text ? DATE.exec(text) ?? COMPACT.exec(text) : null;
  if (!m) return '';
  const check = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return check.getUTCMonth() === +m[2] - 1 && check.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
