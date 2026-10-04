// Small presentation helpers shared by the auth screens. (A bank's answer is
// read by lib/bank-answer.ts, which every screen shares.)

/** A Bankleitzahl the way it is printed on German cards and statements: 570 501 20. */
export function fmtBlz(blz: string): string {
  const d = String(blz || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(blz || '');
}
