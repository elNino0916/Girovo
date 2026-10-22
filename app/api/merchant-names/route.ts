// Clean payee names for the lists ("PAYPAL *EBAY" → "eBay"), from Gemini Nano
// on Android (lib/nano-names.ts, mobile/server/categories.ts). The desktop has
// no model that knows brands: there this answers "unavailable", and the lists
// keep the bank's names tidied by rule.

import { body, json, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';
import { guessNames, namesAvailable } from '@/lib/category-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITEMS = 400;
const MAX_TEXT = 200;

const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');

export const POST = wrap(async (req: Request) => {
  const { sessionId, items } = await body<{ sessionId: string; items?: unknown[] }>(req);
  if (!getSession(sessionId)) return json({ names: {} });
  if (!namesAvailable()) return json({ names: {}, unavailable: true });
  const parsed = (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS).flatMap((raw) => {
    const r = raw as Record<string, unknown> | null;
    const key = text(r?.key);
    const name = text(r?.name);
    return key && name ? [{ key, name }] : [];
  });
  if (!parsed.length) return json({ names: {} });
  return json({ names: await guessNames(parsed) });
});
