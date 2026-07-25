// TEMPORARY probe — inspects real logo pixels for transparency. Deleted after verification.
import { json } from '@/lib/api';
import { resolveMerchants } from '@/lib/merchants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const names = ['PayPal Europe S.a.r.l et Cie S.C.A.', 'DB Vertrieb GmbH', 'AMAZON EU S.A R.L.', 'NETFLIX INTERNATIONAL B.V.'];
  const resolved = await resolveMerchants(names);
  return json(resolved);
}
