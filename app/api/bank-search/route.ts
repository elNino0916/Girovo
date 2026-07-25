// BLZ / name / city / BIC search over the full institute database.

import type { NextRequest } from 'next/server';
import { searchBanks } from '@/lib/banks';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  return json(searchBanks(q, 25));
}
