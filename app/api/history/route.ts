// The Umsätze kept on this computer (lib/history-store.ts): read them, start
// over after a PIN change, delete them from this machine — and, for a
// further bank of the view, follow the primary login's choice (follow).
//
// One POST with an `op`, like the vault's route — the sessionId stays in the
// body, never in a URL. There is no way in for bookings: the server keeps what
// the bank answered (app/api/transactions, app/api/tan-poll), and the browser
// only ever reads. Nothing about the contents is logged; a refusal comes back
// as a status the client can tell apart from an expired session.

import { body, fail, json, sessionExpired, wrap } from '@/lib/api';
import type { HistoryGetResponse } from '@/lib/history';
import { HistoryError, loadHistory, resetHistory, wipeHistory } from '@/lib/history-store';
import { msgs } from '@/lib/i18n';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type HistoryBody = { sessionId: string; op: 'get' | 'reset' | 'wipe' | 'follow'; primary?: string };

export const POST = wrap(async (req: Request) => {
  const b = await body<HistoryBody>(req);
  const s = getSession(b.sessionId);
  if (!s) return sessionExpired();

  try {
    switch (b.op) {
      case 'get':
        return json((await loadHistory(s)) satisfies HistoryGetResponse);
      case 'reset':
        return json((await resetHistory(s)) satisfies HistoryGetResponse);
      case 'follow': {
        // A further bank of the view keeps its Umsätze when the primary
        // login's vault says so (Session.keepChoiceFrom). Both sessions are
        // the browser's own; a session never follows itself.
        const primary = getSession(b.primary);
        if (!primary || primary === s) return fail(msgs().history.server.unavailable, 409);
        s.keepChoiceFrom = primary.id;
        return json({ ok: true });
      }
      case 'wipe':
        // Switching "Umsätze auf diesem Rechner behalten" off. Deleting the
        // saved data (app/api/vault, app/api/forget-device) takes these too.
        return json({ ok: true, wiped: await wipeHistory(s) });
      default:
        return fail(msgs().history.server.unknownAction);
    }
  } catch (err) {
    if (err instanceof HistoryError) return fail(err.message, err.status);
    throw err; // wrap() logs the message only — never a payload
  }
});
