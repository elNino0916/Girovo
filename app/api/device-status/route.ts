// Whether a remembered device profile exists for (BLZ, user). Does not need
// the PIN — only reveals existence, not contents.

import type { NextRequest } from 'next/server';
import { json } from '@/lib/api';
import { hasProfile } from '@/lib/state-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const blz = (req.nextUrl.searchParams.get('blz') || '').trim();
  const userId = (req.nextUrl.searchParams.get('userId') || '').trim();
  return json({ remembered: !!(blz && userId && hasProfile(blz, userId)) });
}
