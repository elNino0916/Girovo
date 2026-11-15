// Bookings whose counterparty stands in the purpose instead of its fields.
//
// Targobank's camt leaves the related parties out and writes everything as
// lines of the purpose (one Ustrd each, joined by lib-fints with "\n"),
// starting with the booking text once more:
//
//   SEPA LASTSCHRIFT                         ← the booking text again
//   PayPal Europe S.a.r.l. et Cie S.C.A      ← the payee
//   1053918153621/PP.1405.PP/. ZOEVA GmbH, Ihr Einkauf bei ZOEVA GmbH
//   Kundenreferenz: 1053918153621
//   Gläubiger-ID : LU96ZZZ0000000000000000058
//   Mandat: 5TWJ2252J7QQE
//   IBAN: LU89751000135104200E
//
//   ECHTZEITÜBERWEISUNG INLAND / TBOL / NINO BORNEMANN / DEUTSCHLANDTICKET /
//   IBAN DE… BIC … / AM 03.11.2026 UM 15.48.36
//
//   NFC KARTENZAHLUNG / OIL 120 / /Urbar / // 74003818 / AM 10.11.2026 … /
//   KARTENNUMMER … GÜLTIG BIS 08/27
//
//   RESERV. BETRAG POS / EUR / 78,01 / AUTORISIERUNGSNR / 765455 /
//   KARTENNUMMER(…) / OIL 120 / Urbar / DE
//
// With the payee field empty every such booking was named by its booking
// text: "SEPA Lastschrift", "Gutschrift", and Verträge grouped all of them
// as one. This moves the payee, the IBAN, the BIC and the references into
// their own fields, as a bank that fills them sends them, and leaves the
// purpose with the rest. Only a booking that names nobody, whose purpose is
// in lines and starts with its own booking text, is touched; a line is moved
// only when its field takes it.
//
// `fromPurpose` marks a booking done ("purpose remoteName remoteIban …": the
// fields it filled). The booking's key (lib/categories.ts txKey) reads the
// name and IBAN as they were before, so what the user filed for a booking
// stays with it.
//
// Pure and node-test-safe: no path aliases, no imports but types.

import type { SerializedTransaction } from './fints-types';

type Booking = Pick<
  SerializedTransaction,
  'purpose' | 'bookingText' | 'amount' | 'remoteName' | 'remoteIban' | 'remoteBic' | 'mandateReference' | 'customerReference'
> & { creditorId?: string; ultimateName?: string; fromPurpose?: string };

type Field = 'remoteIban' | 'remoteBic' | 'creditorId' | 'mandateReference' | 'customerReference';

/** Letters and digits only, upper case: "SEPA-Lastschrift" and "SEPA LASTSCHRIFT" are one text. */
const bare = (s: unknown) => String(s ?? '').normalize('NFC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');

const lines = (purpose: unknown) =>
  String(purpose ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

const IBAN = '([A-Z]{2}\\d{2}[A-Z0-9]{11,30})';
const BIC = '([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)';

// A line that is one identifier, labelled the way Targobank labels it.
const IDENTIFIERS: ReadonlyArray<{ re: RegExp; fields: Field[] }> = [
  { re: new RegExp(`^IBAN\\s*:?\\s*${IBAN}(?:\\s+BIC\\s*:?\\s*${BIC})?$`, 'i'), fields: ['remoteIban', 'remoteBic'] },
  { re: new RegExp(`^BIC\\s*:?\\s*${BIC}$`, 'i'), fields: ['remoteBic'] },
  { re: /^Gl(?:ä|ae|a)ubiger[- ]?ID\s*:\s*([A-Z]{2}\d{2}[A-Z0-9]{4,31})$/i, fields: ['creditorId'] },
  { re: /^Mandat(?:sreferenz|sref\.?)?\s*:\s*(\S{1,35})$/i, fields: ['mandateReference'] },
  { re: /^Kunden-?ref(?:erenz|\.)?\s*:\s*(\S.{0,34})$/i, fields: ['customerReference'] },
];

// Bookings that name no one: the bank's own (a fee, interest, the account's
// closing, a card's monthly bill) and cash.
const OWN_BOOKING = /ENTGELT|GEBUEHR|GEBÜHR|ZINS|ABSCHLUSS|SALDO|KONTOFUEHRUNG|KONTOFÜHRUNG|PORTO|ABRECHNUNG|BARGELD|GELDAUTOMAT|AUSZAHLUNG|EINZAHLUNG/;
// Matched on bare text: "NFC KARTENZAHLUNG" → "NFCKARTENZAHLUNG", "RESERV. BETRAG POS" → "RESERVBETRAGPOS".
const CARD_BOOKING = /KARTENZAHLUNG|KARTENUMSATZ|POS$/;
const RESERVATION = /RESERV/;
// Targobank's channel of an order ("TBOL": online banking) before the payee.
const CHANNEL = /^TB[A-Z0-9]{1,4}$/;
// How a purpose starts, never a name: "Rechnung 4711 vom", "Miete Mai".
const PURPOSE_WORD = /^(?:rechnung|rg\.?|re\.|beitrag|miete|kunden|vertrag|abrechnung|bestellung|auftrag|zahlung|rate|erstattung|einkauf|kaufpreis|mitglied|versicherung|police|referenz|ref\.?|order|invoice)\b/i;

/** A line that can be a name: words, not a reference, a date, a label or a terminal's record. */
function nameLike(line: string | undefined): line is string {
  if (!line || line.length < 2 || line.length > 70) return false;
  if (/^[/\d]/.test(line) || line.includes(':') || PURPOSE_WORD.test(line)) return false;
  if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(line)) return false;
  if (/AUTORISIERUNG|KARTENNUMMER|GÜLTIG BIS|GUELTIG BIS/i.test(line)) return false;
  const letters = (line.match(/\p{L}/gu) || []).length;
  const digits = (line.match(/\d/g) || []).length;
  return letters >= 2 && digits <= 4 && !/^[A-Z]{3}$/.test(line);
}

/**
 * The booking with its payee and identifiers read out of the purpose lines,
 * or the very booking when it names its payee already, is not in that shape,
 * or was done before.
 */
export function withPartyFromPurpose<T extends Booking>(tx: T): T {
  if (tx.fromPurpose) return tx;
  if (String(tx.remoteName ?? '').trim() || String(tx.ultimateName ?? '').trim()) return tx;
  const purpose = String(tx.purpose ?? '');
  // SEPA tags: a bank that structures its purpose, read by lib/sepa-purpose.ts.
  if (!purpose.includes('\n') || /(?:EREF|KREF|MREF|CRED|SVWZ)\+/.test(purpose)) return tx;
  const booking = bare(tx.bookingText);
  const all = lines(purpose);
  if (!booking || all.length < 2 || bare(all[0]) !== booking) return tx;

  const out: T = { ...tx };
  const filled: string[] = [];
  const rest: string[] = [];
  for (const line of all.slice(1)) {
    let taken = false;
    for (const { re, fields } of IDENTIFIERS) {
      const m = re.exec(line);
      if (!m) continue;
      // Taken only when every value it holds ends up in its field.
      const fits = fields.every((f, i) => {
        const v = m[i + 1];
        if (!v) return true;
        const have = String(out[f] ?? '').replace(/\s+/g, '');
        return !have || have.toUpperCase() === v.replace(/\s+/g, '').toUpperCase();
      });
      if (!fits) break;
      fields.forEach((f, i) => {
        const v = m[i + 1];
        if (v && !String(out[f] ?? '').trim()) {
          (out as Record<Field, string>)[f] = f === 'remoteIban' || f === 'remoteBic' || f === 'creditorId' ? v.toUpperCase() : v;
          filled.push(f);
        }
      });
      taken = true;
      break;
    }
    if (!taken) rest.push(line);
  }

  const kind = booking;
  let name = '';
  if (!OWN_BOOKING.test(kind)) {
    if (CARD_BOOKING.test(kind) && RESERVATION.test(kind)) {
      // The shop follows the card's number: KARTENNUMMER(…) / OIL 120 / Urbar / DE.
      const at = rest.findIndex((l) => /^KARTENNUMMER/i.test(l));
      if (at >= 0 && nameLike(rest[at + 1])) name = rest.splice(at + 1, 1)[0];
    } else if (CARD_BOOKING.test(kind)) {
      if (nameLike(rest[0])) name = rest.shift()!;
    } else {
      // An order from online banking names its channel first ("TBOL"); it
      // stays in the purpose, after the rest.
      const channel = CHANNEL.test(rest[0] ?? '') && nameLike(rest[1]) ? rest.shift()! : '';
      if (nameLike(rest[0])) name = rest.shift()!;
      if (channel) rest.push(channel);
    }
  }
  if (name) {
    out.remoteName = name;
    filled.push('remoteName');
  }
  out.purpose = rest.join('\n');
  out.fromPurpose = ['purpose', ...filled].join(' ');
  return out;
}

/** Whether `field` was filled from the purpose (and so was empty as the bank sent it). */
export function filledFromPurpose(tx: { fromPurpose?: string }, field: 'remoteName' | 'remoteIban'): boolean {
  return !!tx.fromPurpose && tx.fromPurpose.split(' ').includes(field);
}

/**
 * Where a card was used, from a booking read out of its purpose lines:
 * "/Urbar" under the shop, or the town and country after a reservation's
 * card number. Null for any other booking.
 */
export function purposePlace(tx: Pick<Booking, 'purpose' | 'bookingText' | 'fromPurpose'>): { city: string; country: string | null } | null {
  if (!tx.fromPurpose || !filledFromPurpose(tx, 'remoteName')) return null;
  const kind = bare(tx.bookingText);
  if (!CARD_BOOKING.test(kind)) return null;
  const rest = lines(tx.purpose);
  const country = (l: string | undefined) => (l && /^[A-Z]{2}$/.test(l) ? l : null);
  if (RESERVATION.test(kind)) {
    const at = rest.findIndex((l) => /^KARTENNUMMER/i.test(l));
    const city = at >= 0 ? rest[at + 1] : undefined;
    return city && /^\p{L}[\p{L} .'-]{1,40}$/u.test(city) ? { city, country: country(rest[at + 2]) } : null;
  }
  const m = /^\/([^/].{0,40})$/.exec(rest[0] ?? '');
  return m ? { city: m[1].trim(), country: country(rest[1]) } : null;
}

/** A purpose line that is only the record of a card terminal: "// 74003818", "AUTORISIERUNGSNR. 693421", "KARTENNUMMER …". */
export function isCardRecordLine(line: string): boolean {
  return /^\/|AUTORISIERUNG|KARTENNUMMER|GÜLTIG BIS|GUELTIG BIS/i.test(line.trim());
}

/**
 * The amount a card reservation holds, where the bank books it as 0,00 and
 * names the sum in the purpose ("RESERV. BETRAG POS / EUR / 78,01"): what
 * will be taken, as a debit. Null for anything else.
 */
export function reservedAmount(tx: Pick<Booking, 'purpose' | 'bookingText' | 'amount' | 'fromPurpose'>): { amount: number; currency: string } | null {
  // Only a card's (POS) booking read out of its purpose lines: another bank's
  // "Reservierung Hotel" at 0,00 is not one.
  const kind = bare(tx.bookingText);
  if (Number(tx.amount) !== 0 || !tx.fromPurpose || !RESERVATION.test(kind) || !CARD_BOOKING.test(kind)) return null;
  const rest = lines(tx.purpose);
  for (let i = 0; i < rest.length - 1; i++) {
    if (!/^[A-Z]{3}$/.test(rest[i])) continue;
    const m = /^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/.exec(rest[i + 1]);
    if (!m) continue;
    const value = Number(`${m[1].replace(/\./g, '')}.${m[2]}`);
    if (Number.isFinite(value) && value > 0) return { amount: -value, currency: rest[i] };
  }
  return null;
}
