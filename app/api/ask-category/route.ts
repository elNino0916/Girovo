// "Frag deine Umsätze" on the desktop: the category a question is about, read
// by the built-in category model (lib/category-model.ts questionCategory) from
// what is left of the question once its fillers are gone (lib/nano-ask.ts
// questionTopic). Runs in this process; nothing leaves the machine. No model,
// a failure or no clear category all answer with none, and the question is
// read by rule alone.

import { body, json, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';
import { modelAvailable, questionCategory } from '@/lib/category-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TEXT = 160;

export const POST = wrap(async (req: Request) => {
  const { sessionId, topic } = await body<{ sessionId: string; topic?: unknown }>(req);
  // Only a signed-in session may run the model, so nothing else on the machine can keep it busy.
  if (!getSession(sessionId)) return json({ category: null });
  if (!modelAvailable()) return json({ category: null, unavailable: true });
  const text = typeof topic === 'string' ? topic.slice(0, MAX_TEXT).trim() : '';
  if (!text) return json({ category: null });
  return json({ category: await questionCategory(text).catch(() => null) });
});
