// An invoice paid from its GiroCode waits for its booking (lib/docs.ts
// AwaitedBooking): once the bank books the transfer, the booking takes the
// invoice. Which booking that is, is decided here.
//
// A booking matches when it is money going out to the IBAN the order went
// to, for exactly the amount, booked from the day before the order was sent
// (a value date can lead) to two weeks after it (a scheduled transfer, a
// slow bank). Of several, the earliest; and one booking takes one invoice.
//
// Pure: for the provider and `node --test`.

import type { SerializedTransaction } from './fints-types';
import type { KeptDoc } from './docs.ts';
import { txKey } from './categories.ts';

const DAY = 24 * 60 * 60 * 1000;
/** How long after the order a booking may still be its own. */
export const AWAIT_DAYS = 14;

const dayOf = (v: Date | string) => new Date(String(v).slice(0, 10) + 'T12:00:00').getTime();

/** The waiting receipts among `docs` that bookings of `txs` take: each once, the earliest booking first. */
export function matchAwaiting(docs: KeptDoc[], txs: SerializedTransaction[]): { doc: KeptDoc; tx: SerializedTransaction; key: string }[] {
  const taken = new Set<string>();
  const out: { doc: KeptDoc; tx: SerializedTransaction; key: string }[] = [];
  const waiting = docs
    .filter((d) => d.kind === 'receipt' && !d.tx && d.awaiting)
    .sort((a, b) => a.awaiting!.sentAt.localeCompare(b.awaiting!.sentAt));
  for (const doc of waiting) {
    const want = doc.awaiting!;
    const sent = dayOf(want.sentAt);
    const hit = txs
      .filter((t) => {
        if (!(t.amount < 0) || Math.round(-t.amount * 100) !== want.cents) return false;
        if (String(t.remoteIban || '').replace(/\s+/g, '').toUpperCase() !== want.iban) return false;
        const booked = dayOf(t.entryDate || t.valueDate);
        return booked >= sent - DAY && booked <= sent + AWAIT_DAYS * DAY && !taken.has(txKey(t));
      })
      .sort((a, b) => dayOf(a.entryDate || a.valueDate) - dayOf(b.entryDate || b.valueDate))[0];
    if (!hit) continue;
    const key = txKey(hit);
    taken.add(key);
    out.push({ doc, tx: hit, key });
  }
  return out;
}

/** A receipt that has waited longer than any booking would take: the transfer never arrived as sent. */
export function awaitedTooLong(doc: KeptDoc, now = Date.now()): boolean {
  return !!doc.awaiting && now - Date.parse(doc.awaiting.sentAt) > (AWAIT_DAYS + 2) * DAY;
}
