// App metadata (product-ID status, DB size) for the frontend.

import { bankCount } from '@/lib/banks';
import { json } from '@/lib/api';
import { MERCHANT_LOGOS, PLACEHOLDER_ID, PRODUCT_ID } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return json({
    productRegistered: PRODUCT_ID !== PLACEHOLDER_ID,
    bankCount,
    merchantLogos: MERCHANT_LOGOS,
  });
}
