// Which files the i18n guard reads (lib/i18n/guard.test.ts,
// scripts/i18n-check.mjs), and which it leaves alone and why.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Whole files of German that is data, not interface: what a bank writes and
 * the code recognises, or text a model compares bookings with. Translating
 * any of it would break the recognition, not localise the app.
 */
export const DATA_FILES: Record<string, string> = {
  'lib/category-model.ts': "the category model's descriptions — German, like the bookings they are compared with",
  'lib/categorize.ts': 'keywords matched against German booking texts',
  'lib/card-purpose.ts': 'card terminal descriptors and the words around them',
  'lib/merchant-match.ts': 'legal forms, towns and given names found in counterparty names',
  'lib/merchants.ts': 'brand names and the words a search for them must skip',
  'lib/banks.ts': 'bank names and towns from the institute database',
  'electron/i18n.cjs': "the desktop shell's own texts, in both languages",
};

const ROOTS = ['app', 'components', 'lib', 'electron'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'design-preview', '__fixtures__', 'messages']);

/** Every source file the guard reads, relative to `root`, with forward slashes. */
export function SCANNED_FILES(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(rel);
      } else if (/\.(tsx?|cjs|mjs)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name) && !DATA_FILES[rel]) {
        out.push(rel);
      }
    }
  };
  for (const r of ROOTS) if (fs.existsSync(path.join(root, r))) walk(r);
  return out.sort();
}
