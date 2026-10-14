// `next/server` for the phone server: the route handlers only use
// NextResponse.json (lib/api.ts) and read `req.nextUrl` (mobile/server/router.ts
// puts it on every request).

export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}

export type NextRequest = Request & { nextUrl: URL };
