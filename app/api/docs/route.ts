// Documents kept on this machine (lib/doc-store.ts): list them, open one,
// attach a receipt to a booking (or to an order not booked yet), move it to
// its booking, remove one.
//
// One POST with an `op`, like /api/vault — the sessionId stays in the body.
// Nothing about a document is logged. A refusal comes back as a status the
// client can tell apart from an expired session (409 locked, 413 too large or
// full, 415 not a document, 404 gone).

import { boundedBody, fail, json, sessionExpired, wrap } from '@/lib/api';
import { DocError, addReceipt, linkReceipt, listDocs, readDoc, removeDoc } from '@/lib/doc-store';
import { DOC_REQUEST_MAX_BYTES, type AwaitedBooking, type DocGetResponse, type DocResponse, type DocsListResponse } from '@/lib/docs';
import { msgs } from '@/lib/i18n';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DocsBody = {
  sessionId: string;
  op: 'list' | 'get' | 'addReceipt' | 'link' | 'remove';
  id?: string;
  name?: string;
  /** The document, base64. */
  data?: string;
  accountNumber?: string | null;
  tx?: string | null;
  awaiting?: AwaitedBooking | null;
};

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export const POST = wrap(async (req: Request) => {
  const b = await boundedBody<DocsBody>(req, DOC_REQUEST_MAX_BYTES);
  if (!b) return fail(msgs().docs.server.tooLarge, 413);
  const s = getSession(b.sessionId ?? '');
  if (!s) return sessionExpired();

  try {
    switch (b.op) {
      case 'list':
        return json((await listDocs(s)) satisfies DocsListResponse);
      case 'get': {
        if (!isId(b.id)) return fail(msgs().docs.server.gone, 404);
        const { doc, bytes } = await readDoc(s, b.id);
        return json({ doc, data: bytes.toString('base64') } satisfies DocGetResponse);
      }
      case 'addReceipt': {
        if (typeof b.data !== 'string' || !b.data) return fail(msgs().docs.server.notADocument, 415);
        const doc = await addReceipt(s, {
          name: text(b.name, 200) ?? '',
          data: Buffer.from(b.data, 'base64'),
          accountNumber: text(b.accountNumber, 40),
          tx: text(b.tx, 400),
          awaiting: b.awaiting ?? null,
        });
        return json({ doc } satisfies DocResponse);
      }
      case 'link': {
        const tx = text(b.tx, 400);
        if (!isId(b.id) || !tx) return fail(msgs().docs.server.format);
        return json({ doc: await linkReceipt(s, b.id, tx, text(b.accountNumber, 40)) } satisfies DocResponse);
      }
      case 'remove':
        if (isId(b.id)) await removeDoc(s, b.id);
        return json({ ok: true });
      default:
        return fail(msgs().docs.server.format);
    }
  } catch (err) {
    if (err instanceof DocError) return fail(err.message, err.status);
    throw err; // wrap() logs the message only — never a payload
  }
});
