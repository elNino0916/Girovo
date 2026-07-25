// Serve a resolved company logo.
//
// The bytes are proxied rather than linked so the page stays same-origin and
// each mark is fetched from Wikimedia Commons once per server run. Only ids
// minted by the resolver are known, so this cannot be pointed at another host.

import type { NextRequest } from 'next/server';
import { fetchLogo } from '@/lib/merchants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^[a-f0-9]{20}$/.test(id)) return new Response('Not found', { status: 404 });

  const logo = await fetchLogo(id);
  if (!logo) return new Response('Not found', { status: 404 });

  return new Response(logo.body as BodyInit, {
    headers: {
      'Content-Type': logo.type,
      'Content-Length': String(logo.body.byteLength),
      // The id is a hash of the upstream URL, so the bytes behind it never change.
      'Cache-Control': 'public, max-age=604800, immutable',
    },
  });
}
