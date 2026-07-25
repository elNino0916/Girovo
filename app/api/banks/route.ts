// Curated quick-pick banks for the login screen.

import { POPULAR_BANKS } from '@/lib/banks';
import { json } from '@/lib/api';

export const runtime = 'nodejs';

export function GET() {
  return json(POPULAR_BANKS);
}
