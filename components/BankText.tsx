'use client';

// A bank's free text — a Verwendungszweck, a reference — with the amounts in
// it masked while "Beträge ausblenden" is on (lib/mask.ts). Masked here, at
// render time, because the strings themselves are cached per booking and must
// come back unchanged when the mode is switched off.
//
// Each mask is drawn the way <Money> draws one: the dots, named "Betrag
// ausgeblendet" for a screen reader instead of five bullets read aloud. And
// like <Money> it reads the mode on its own, so a memoised row does not have
// to subscribe to the provider just for this.

import { AMOUNT_MASK, amountParts } from '@/lib/mask';
import { MASKED_LABEL, usePrivacy } from './Money';

export function BankText({ text }: { text: string }) {
  const privacy = usePrivacy();
  if (!privacy) return <>{text}</>;
  return (
    <>
      {amountParts(text).map((p, i) => (p.amount
        ? <span key={i} role="img" aria-label={MASKED_LABEL}>{AMOUNT_MASK}</span>
        : p.text))}
    </>
  );
}
