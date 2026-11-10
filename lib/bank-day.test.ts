import './__fixtures__/tz-new-york.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvExport } from './bank-import.ts';
import { csvDateCell, csvStatus, transactionsToCsv } from './csv.ts';
import type { SerializedAccount, SerializedTransaction } from './fints-types';
import { daysFromToday, dayKey, fmtDate, groupLabel, isFutureDate } from './format.ts';
import { bookingDay, newestFirst } from './history.ts';
import { withLocale } from './i18n/server.ts';

// A bank day is a day, not a moment: the 3rd stays the 3rd on a device that
// is not on German time. Bookings carry their day three ways — a bare
// yyyy-mm-dd (a CSV read from a file), the JSON of a local midnight (MT940)
// and of a local noon (camt) — and every one of them has to be read as the
// local day it names.

const ZONES = ['America/New_York', 'Pacific/Honolulu', 'UTC', 'Europe/Berlin', 'Pacific/Kiritimati'];

/** Runs `fn` with the process on `zone`'s time (Node applies a TZ change at once). */
function inZone(zone: string, fn: () => void): void {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    fn();
  } finally {
    process.env.TZ = was;
  }
}

const FILE = [
  'Buchungstag;Valuta;Name;Verwendungszweck;Betrag',
  '03.11.2025;03.11.2025;REWE Markt GmbH;Einkauf;-23,45',
].join('\n');

const ACCOUNT: SerializedAccount = {
  accountNumber: '1234593271', iban: 'DE78 5001 0517 0012 3459 32', bic: 'INGDDEFFXXX', currency: 'EUR', accountType: 'CheckingAccount',
  holder: 'NINO MUSTER', product: 'Girokonto', limit: null, canStatements: true, canBalance: true, canTransfer: true,
  canInstant: true, canPending: true,
};

test('the fixture took: this process is on New York time', () => {
  assert.equal(new Date('2025-11-03').getDate(), 2, 'UTC midnight is the evening before here');
});

test('a booking read from a file is shown and exported under its own day', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      const [tx] = parseCsvExport(FILE).txs;
      assert.equal(bookingDay(tx), '2025-11-03', zone);
      assert.equal(fmtDate(tx.entryDate), '03.11.2025', zone);
      assert.equal(withLocale('en', () => fmtDate(tx.entryDate)), '03/11/2025', zone);
      assert.equal(csvDateCell(tx.entryDate), '03.11.2025', zone);
      const csv = transactionsToCsv([tx], { account: ACCOUNT, bankName: 'ING', today: new Date(2026, 0, 15) });
      assert.match(csv, /;03\.11\.2025;03\.11\.2025;REWE Markt GmbH;/, zone);
      // And read back from that file it is the same day again.
      assert.equal(bookingDay(parseCsvExport(csv).txs[0]), '2025-11-03', zone);
    });
  }
});

test('a day from MT940 (local midnight) or camt (local noon) stays the day it was read as', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      for (const at of [new Date(2025, 10, 3), new Date(2025, 10, 3, 12)]) {
        assert.equal(fmtDate(at), '03.11.2025', zone);
        assert.equal(fmtDate(at.toISOString()), '03.11.2025', zone);
        assert.equal(csvDateCell(at.toISOString()), '03.11.2025', zone);
      }
    });
  }
});

test('the Status column and "Noch nicht gebucht" measure a bare day against the local today', () => {
  for (const zone of ZONES) {
    inZone(zone, () => {
      const today = new Date(2025, 10, 3, 9);
      const status = (day: string) => csvStatus({ entryDate: day, valueDate: day }, today);
      assert.equal(status('2025-11-03'), 'Gebucht', zone);
      assert.equal(status('2025-11-04'), 'Noch nicht gebucht', zone);
      assert.equal(status('2025-11-02'), 'Gebucht', zone);

      const now = dayKey(new Date());
      const [y, m, d] = now.split('-').map(Number);
      const tomorrow = dayKey(new Date(y, m - 1, d + 1));
      const yesterday = dayKey(new Date(y, m - 1, d - 1));
      assert.deepEqual([daysFromToday(now), daysFromToday(tomorrow), daysFromToday(yesterday)], [0, -1, 1], zone);
      assert.deepEqual([isFutureDate(now), isFutureDate(tomorrow)], [false, true], zone);
      assert.deepEqual([groupLabel(now), groupLabel(tomorrow), groupLabel(yesterday)], ['Heute', 'Morgen', 'Gestern'], zone);
    });
  }
});

test('what is no date shows nothing, and never throws', () => {
  assert.equal(fmtDate('morgen'), '');
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate(null), '');
  assert.equal(csvDateCell('morgen'), '');
  assert.equal(daysFromToday('morgen'), null);
});

test('newest first: a bare day sorts as that local day among the bank’s own dates', () => {
  const tx = (entryDate: string, purpose: string) => ({ entryDate, valueDate: entryDate, purpose }) as SerializedTransaction;
  for (const zone of ZONES) {
    inZone(zone, () => {
      const file3 = tx('2025-11-03', 'file, the 3rd');
      const midnight3 = tx(new Date(2025, 10, 3).toISOString(), 'MT940, the 3rd');
      const noon2 = tx(new Date(2025, 10, 2, 12).toISOString(), 'camt, the 2nd');
      const midnight4 = tx(new Date(2025, 10, 4).toISOString(), 'MT940, the 4th');
      // The same day from a file and from MT940 is the same moment: the order given stays.
      assert.deepEqual(newestFirst([noon2, file3, midnight3, midnight4]).map((t) => t.purpose),
        ['MT940, the 4th', 'file, the 3rd', 'MT940, the 3rd', 'camt, the 2nd'], zone);
      assert.deepEqual(newestFirst([midnight3, file3]).map((t) => t.purpose), ['MT940, the 3rd', 'file, the 3rd'], zone);
    });
  }
});
