// Curated quick-pick banks for the login screen — or, with ?blz=, whether one
// bank is still in the list (the login screen checks a remembered bank at
// start, before anyone types a PIN for it).

import type { NextRequest } from 'next/server';
import { POPULAR_BANKS, lookupBlz } from '@/lib/banks';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const blz = req.nextUrl.searchParams.get('blz');
  if (blz !== null) {
    const b = /^\d{8}$/.test(blz) ? lookupBlz(blz) : null;
    return json({
      bank: b ? { blz: b.blz, name: b.name, location: b.location, bic: b.bic, brand: b.brand } : null,
    });
  }
  return json(POPULAR_BANKS);
}
