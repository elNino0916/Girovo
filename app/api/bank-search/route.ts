// Name / city / BLZ / BIC search over the full institute database. An IBAN is
// never sent here — the browser reads its BLZ and asks for that (a GET puts
// its query in the URL, and URLs end up in logs).

import type { NextRequest } from 'next/server';
import { searchBanks } from '@/lib/banks';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  return json(searchBanks(q, 25));
}
