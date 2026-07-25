// Which real logo files exist (public/logos/<brand>.svg|png) — the frontend
// falls back to a monogram chip for brands without one.

import fs from 'node:fs';
import path from 'node:path';
import { json } from '@/lib/api';

export const runtime = 'nodejs';

export function GET() {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(path.join(process.cwd(), 'public', 'logos'))
      .filter((f) => /\.(svg|png)$/i.test(f));
  } catch { /* no logos directory */ }
  return json(files);
}
