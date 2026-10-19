// A backup of what this machine keeps for the view's logins (lib/backup.ts):
// made into one sealed file, or restored from one.
//
// One POST with an `op`, like every other route. The session ids of the
// further banks signed in now come along (`linked`), so a backup carries the
// whole view. Nothing of a backup, a password or a PIN is ever logged.

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { BACKUP_MAX_BYTES, BackupError, backupFileName, makeBackup, readBackup, restoreBackup } from '@/lib/backup';
import { DocError } from '@/lib/doc-store';
import { isoDate } from '@/lib/format';
import { HistoryError } from '@/lib/history-store';
import { msgs } from '@/lib/i18n';
import { getSession, type Session } from '@/lib/session';
import { VaultError } from '@/lib/vault';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BackupBody = { sessionId: string; linked?: unknown; op: 'make' | 'restore'; password?: unknown; text?: unknown };

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';

export const POST = wrap(async (req: Request) => {
  // A whole backup comes in as text: room for the largest, and its JSON around it.
  const b = await boundedBody<BackupBody>(req, BACKUP_MAX_BYTES + 64 * 1024);
  if (!b) return fail(msgs().backup.server.tooLarge, 413);
  const s = getSession(b.sessionId);
  if (!s) return sessionExpired();
  const linked = (Array.isArray(b.linked) ? b.linked : [])
    .map((id) => getSession(id))
    .filter((x): x is Session => !!x && x !== s);
  const sessions = [s, ...linked];

  try {
    switch (b.op) {
      case 'make': {
        const { text, summary } = await makeBackup(sessions, String(b.password ?? ''), APP_VERSION);
        return json({ name: backupFileName(isoDate(new Date())), text, summary });
      }
      case 'restore': {
        const contents = await readBackup(String(b.text ?? ''), String(b.password ?? ''));
        return json({ report: await restoreBackup(sessions, contents) });
      }
      default:
        return fail(msgs().backup.server.unknownAction);
    }
  } catch (err) {
    if (err instanceof BackupError || err instanceof VaultError || err instanceof HistoryError || err instanceof DocError) {
      return fail(err.message, err.status);
    }
    throw err; // wrap() logs the message only — never a payload
  }
});
