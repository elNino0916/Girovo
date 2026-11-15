// The account holder's name as the profile chip and the greeting show it.

import { properName } from './format.ts';

// Forms of address a bank puts in front of a holder's name. They are not
// what anyone calls you.
const TITLES = new Set(['herr', 'herrn', 'frau', 'dr', 'dr.', 'prof', 'prof.', 'dipl.-ing.', 'mr', 'mrs', 'ms']);

// The word a joint account's holder line joins two people with.
const JOINT = /^(und|oder|u\.?|&|\+|and)$/i;

// Words in front of a joint account's names that are no name either.
const LEADS = new Set(['eheleute', 'ehel.', 'familie', 'fam.']);

// A company's legal form: such a holder is no person, and "Meier & Co. KG" is not cut at its "&".
const COMPANY = /\b(gmbh|ag|kg|ohg|gbr|e\.?\s?v\.?|ug|mbh|mbb|partg|se|eg|stiftung|verein)\b/i;

/**
 * A joint account's holder, cut down to the first person. A holder line holds
 * 27 characters at most, so "Mustermann Max Mustermann und Erika" often
 * arrives as "Mustermann Max Mustermann und", and the second line (joined
 * with a comma) is the rest of the partner's name. Where the part before the
 * joining word is a name of its own (two words or more) only that part stays;
 * "Max und Erika Mustermann" stays whole, as the first part is no name alone.
 * A joining word left dangling at the end goes either way.
 */
function firstPerson(s: string): string {
  if (COMPANY.test(s)) return s;
  const words = s.split(' ');
  const at = words.findIndex((w) => JOINT.test(w.replace(/,$/, '')));
  if (at < 0) return s;
  const before = words.slice(0, at).join(' ').replace(/,$/, '').trim();
  // "Herr Max und Frau Erika Mustermann": "Herr Max" is no name of its own.
  const named = before.split(' ').filter((w) => /\p{L}/u.test(w) && !TITLES.has(w.toLowerCase()) && !LEADS.has(w.toLowerCase()));
  if (named.length >= 2) return before;
  // "Max und", with nothing after: the joining word alone goes.
  return words.slice(at + 1).some((w) => /\p{L}/u.test(w)) ? s : before;
}

/**
 * The account holder as the bank stores them, made presentable: "NINO
 * BORNEMANN" → "Nino Bornemann", "BORNEMANN, NINO" → "Nino Bornemann", and a
 * joint account's holder down to its first person (firstPerson).
 */
export function holderName(raw: string | null | undefined): string {
  const s = firstPerson(properName(String(raw ?? '').replace(/\s+/g, ' ').trim()));
  const comma = /^([^,]+),\s*(.+)$/.exec(s);
  return comma ? `${comma[2]} ${comma[1]}` : s;
}

/**
 * The name to greet someone by — the first word that is not a title. Empty
 * for something that does not look like a person (a company account, a
 * joint account "Max und Erika Mustermann" still greets Max, which is who is
 * logged in more often than not, but "Mustermann GmbH" greets nobody).
 */
export function firstName(raw: string | null | undefined): string {
  const name = holderName(raw);
  if (!name || COMPANY.test(name)) return '';
  const word = name.split(' ').find((w) => !TITLES.has(w.toLowerCase()) && !LEADS.has(w.toLowerCase()));
  return word && /\p{L}/u.test(word) ? word : '';
}

/**
 * Whose session it is, for the greeting and the profile chip alike: the first
 * account holder the bank listed at login that reads as a person, else the
 * first holder at all. Stable for the session — switching to a partner's or a
 * company account changes neither the greeting nor the chip.
 */
export function sessionHolder(accounts: readonly { holder?: string | null }[]): string {
  const holders = accounts.map((a) => (a.holder ?? '').trim()).filter(Boolean);
  return holders.find((h) => firstName(h)) ?? holders[0] ?? '';
}

/** Two letters for the profile chip: first and last name, or the first two of one word. */
export function nameInitials(raw: string | null | undefined): string {
  const words = holderName(raw).split(' ')
    .filter((w) => /\p{L}/u.test(w) && !TITLES.has(w.toLowerCase()) && !JOINT.test(w.replace(/,$/, '')));
  if (!words.length) return '';
  const letter = (w: string) => w.match(/\p{L}/u)?.[0] ?? '';
  if (words.length === 1) return words[0].replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase();
  return (letter(words[0]) + letter(words[words.length - 1])).toUpperCase();
}
