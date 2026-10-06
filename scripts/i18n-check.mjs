// Lists interface text written straight into the code instead of
// lib/i18n/messages (lib/i18n/scan.ts):
//
//   node scripts/i18n-check.mjs                     the whole tree, as the guard test sees it
//   node scripts/i18n-check.mjs components/Foo.tsx  just these files
//
// Exits 1 when it finds any. German that is data rather than interface is
// marked in the source (`// i18n-data`, see lib/i18n/scan.ts).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { scanSource } = await import(pathToFileURL(path.join(ROOT, 'lib', 'i18n', 'scan.ts')).href);
const { SCANNED_FILES } = await import(pathToFileURL(path.join(ROOT, 'lib', 'i18n', 'scope.ts')).href);

const files = process.argv.length > 2
  ? process.argv.slice(2).map((f) => path.relative(ROOT, path.resolve(f)).split(path.sep).join('/'))
  : SCANNED_FILES(ROOT);

let total = 0;
for (const file of files) {
  const found = scanSource(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  if (!found.length) continue;
  total += found.length;
  console.log(`\n${file} — ${found.length}`);
  for (const f of found) console.log(`  ${String(f.line).padStart(4)}  ${f.text}`);
}
console.log(total ? `\n${total} text(s) to move into lib/i18n/messages` : 'No interface text outside lib/i18n/messages.');
process.exit(total ? 1 : 0);
