// Older Umsätze from the bank's own export (lib/bank-import.ts): read a file
// and say what it holds (`inspect`), then fill the kept history's gaps with
// it for one account (`import`).
//
// The one way bookings come in other than from the bank's FinTS answer — and
// still not from the browser: it hands over the file the bank made, and the
// server reads it. Only while the login keeps its Umsätze (the vault's
// choice), and only into days not kept yet: what the bank delivered over
// FinTS is never replaced by a file. Nothing of a file is ever logged.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { IMPORT_MAX_BYTES, importHistory, importSpan, matchAccount } from '@/lib/bank-import';
import { parseBankExport } from '@/lib/bank-import-fints';
import { isoDate } from '@/lib/format';
import { HistoryError, fillKeptGaps } from '@/lib/history-store';
import { msgs } from '@/lib/i18n';
import { accountsFor } from '@/lib/serialize';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportBody = { sessionId: string; op: 'inspect' | 'import'; text?: unknown; accountNumber?: unknown };

export const POST = wrap(async (req: Request) => {
  const b = await boundedBody<ImportBody>(req, IMPORT_MAX_BYTES + 64 * 1024);
  const words = msgs().history.import.server;
  if (!b) return fail(words.tooLarge, 413);
  const s = getSession(b.sessionId);
  if (!s) return sessionExpired();

  let parsed;
  try {
    parsed = typeof b.text === 'string' ? parseBankExport(b.text) : null;
  } catch {
    // The parser's message could quote the file: only the refusal goes out.
    parsed = null;
  }
  if (!parsed || !parsed.txs.length) return fail(words.notReadable, 400);
  const today = isoDate(new Date());
  const accounts = accountsFor(s);
  const span = importSpan(parsed, today);

  switch (b.op) {
    case 'inspect':
      return json({
        format: parsed.format,
        bookings: parsed.txs.length,
        skipped: parsed.skipped,
        from: span?.from ?? null,
        to: span?.to ?? null,
        account: matchAccount(parsed.account, accounts),
        // The file names an account this login does not have: said, so the user does not pick a wrong one blindly.
        foreign: !!parsed.account && !matchAccount(parsed.account, accounts),
      });
    case 'import': {
      const account = accounts.find((a) => a.accountNumber === b.accountNumber)?.accountNumber;
      if (!account) return fail(words.noAccount, 400);
      const built = importHistory(parsed, account, today);
      if (!built) return fail(words.nothing, 400);
      try {
        const r = await fillKeptGaps(s, built.data);
        return json({ days: r.days, bookings: r.bookings, from: built.span.from, to: built.span.to });
      } catch (err) {
        if (err instanceof HistoryError) return fail(err.message, err.status);
        throw err;
      }
    }
    default:
      return fail(msgs().history.server.unknownAction);
  }
});
