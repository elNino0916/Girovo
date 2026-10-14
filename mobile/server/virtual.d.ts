// Modules scripts/build-mobile.mjs writes at build time.

declare module 'girovo:assets' {
  /** Virtual path → file text (/app/banks-data.json, /app/config.json). */
  export const ASSETS: Record<string, string>;
  /** Virtual folder → the names in it, contents not held (/app/public/logos). */
  export const LISTINGS: Record<string, string[]>;
}

declare module 'girovo:routes' {
  type Handler = (req: Request, ctx?: unknown) => Response | Promise<Response>;
  /** Every app/api/**\/route.ts, by its URL path ("/api/connect/cancel"). */
  export const ROUTES: Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', Handler>>>;
}
