// Resolve counterparty names to company logos via Brandfetch.
//
// Best-effort by design: an unresolvable name comes back as null and the
// transaction keeps its plain avatar. Never fails the request — a logo is
// decoration, and the statement behind it must render regardless.

import { body, json, wrap } from '@/lib/api';
import { getSession } from '@/lib/session';
import { resolveMerchants } from '@/lib/merchants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = wrap(async (req: Request) => {
  const { sessionId, names } = await body<{ sessionId: string; names: string[] }>(req);
  // Only a signed-in session may spend lookups, so the endpoint can't be used
  // as a free Brandfetch proxy by anything else on the machine.
  if (!getSession(sessionId)) return json({});
  if (!Array.isArray(names) || !names.length) return json({});

  return json(await resolveMerchants(names));
});
