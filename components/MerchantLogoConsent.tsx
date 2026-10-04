'use client';

// "Firmenlogos anzeigen?" — asked once, before a single name goes to the logo
// service. Company logos are the one lookup besides the bank that leaves the
// machine, so they stay off until the user answers, and the answer is theirs
// to change in the Sitzung panel at any time.
//
// A tile on the Übersicht, never a dialog: banking goes on around it, and no
// logo is looked up until it is answered (resolveMerchants in FintsProvider
// holds them). Both answers carry the same weight — the question is asked, not
// sold. A build that does not offer logos never asks.

import { useId, useRef } from 'react';
import { useFints } from './FintsProvider';
import { ImageIcon } from './icons';
import { Button, focusFirst } from './ui';

/** What goes out, said the same way here and at the Sitzung panel's switch. */
export const LOGO_DISCLOSURE =
  'Dafür gehen Namen von Firmen, an die du zahlst, an den Logo-Dienst Brandfetch – keine Beträge, IBANs oder ' +
  'Verwendungszwecke. Wie bei jedem Abruf sieht Brandfetch dabei deine IP-Adresse.';

const CONTROLS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first control after `el` in the page's order: where Tab would have gone next. */
function nextControlAfter(el: HTMLElement): HTMLElement | null {
  for (const x of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.contains(x) || !(el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (x.getClientRects().length) return x;
  }
  return null;
}

export function MerchantLogoConsent() {
  const { meta, logoConsent, setLogoConsent, toast } = useFints();
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  if (!meta?.merchantLogos || logoConsent !== 'unasked') return null;

  const answer = (on: boolean) => {
    const box = ref.current;
    // The tile goes away with the answer. Whoever answered from the keyboard
    // keeps their place: focus moves on to what Tab would have reached next.
    const next = box && box.contains(document.activeElement) ? nextControlAfter(box) : null;
    setLogoConsent(on);
    toast(on ? 'Firmenlogos sind eingeschaltet.' : 'Firmenlogos bleiben aus.', on ? 'success' : 'info');
    if (next) focusFirst([next, document.getElementById('main')]);
  };

  return (
    <section ref={ref} aria-labelledby={titleId} className="panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-inset text-headline">
          <ImageIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="section-head">Firmenlogos anzeigen?</h2>
          <p className="mt-1 text-[14px] leading-snug text-ink-2">{LOGO_DISCLOSURE}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => answer(true)}>Logos laden</Button>
            <Button size="sm" variant="secondary" onClick={() => answer(false)}>Nein danke</Button>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-ink-3">
            Du kannst das jederzeit im Sitzungsmenü oben rechts ändern.
          </p>
        </div>
      </div>
    </section>
  );
}
