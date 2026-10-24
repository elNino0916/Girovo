// Prints the GiroCodes the r5 mocks show, as SVG path data (lib/qr.ts, lib/girocode.ts).
// Run: node .impeccable/mocks/decision/r5/qr.mts > .impeccable/mocks/decision/r5/qr.json
import { buildEpcPayload } from '../../../../lib/girocode.ts';
import { qrMatrix, qrSvgPath } from '../../../../lib/qr.ts';

const own = { name: 'NINO BECKER', iban: 'DE62570699990105593271', bic: 'GENODED1MST' };
const codes = {
  lea: { ...own, amount: 7.7, purpose: 'Anteil Sushi Yana, 21.10.' },
  jo: { ...own, amount: 7.7, purpose: 'Anteil Sushi Yana, 21.10.' },
  mia: { ...own, amount: 7.7, purpose: 'Anteil Sushi Yana, 21.10.' },
};
const out: Record<string, { d: string; size: number }> = {};
for (const [k, v] of Object.entries(codes)) out[k] = qrSvgPath(qrMatrix(buildEpcPayload(v)));
console.log(JSON.stringify(out));
