// The on-device category guess (lib/category-model.ts) for the bookings the
// keyword rules left as "Sonstiges". Runs in this process; nothing leaves the
// machine. Best-effort like the logos: no model, a failure or no clear guess
// all answer with no category, and the booking keeps "Sonstiges".

import { body, json, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';
import { GUESSABLE, guessCategories, modelAvailable, type GuessExample, type GuessItem, type GuessableCategory } from '@/lib/category-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITEMS = 400;
const MAX_EXAMPLES = 400;
const MAX_TEXT = 200;

const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const guessable = (v: unknown): v is GuessableCategory => typeof v === 'string' && (GUESSABLE as string[]).includes(v);

export const POST = wrap(async (req: Request) => {
  const { sessionId, items, examples } = await body<{ sessionId: string; items?: unknown[]; examples?: unknown[] }>(req);
  // Only a signed-in session may run the model, so nothing else on the
  // machine can keep it busy.
  if (!getSession(sessionId)) return json({ guesses: {} });
  if (!modelAvailable()) return json({ guesses: {}, unavailable: true });

  const parsedItems: GuessItem[] = (Array.isArray(items) ? items : []).slice(0, MAX_ITEMS).flatMap((raw) => {
    const r = raw as Record<string, unknown> | null;
    const key = text(r?.key);
    const name = text(r?.name);
    return key && name ? [{ key, name, purpose: text(r?.purpose) }] : [];
  });
  const parsedExamples: GuessExample[] = (Array.isArray(examples) ? examples : []).slice(0, MAX_EXAMPLES).flatMap((raw) => {
    const r = raw as Record<string, unknown> | null;
    const name = text(r?.name);
    return name && guessable(r?.category) ? [{ name, category: r.category }] : [];
  });
  if (!parsedItems.length) return json({ guesses: {} });

  return json({ guesses: await guessCategories(parsedItems, parsedExamples) });
});
