'use client';

// "Nutzungsdaten teilen?" — asked once in the desktop app, as a tile on the
// Übersicht like the company-logo question (MerchantLogoConsent.tsx): banking
// goes on around it, both answers carry the same weight, and the answer is
// the user's to change in the Sitzung panel at any time. No usage event goes
// out before a yes. Error reports do not wait for one, and the tile says so.

import { useId, useRef } from 'react';
import { useFints } from '../FintsProvider';
import { ChartIcon } from '../icons';
import { Button, focusFirst } from '../ui';
import { ERROR_REPORTS_NOTE, USAGE_DISCLOSURE, setUsageConsent, useUsageConsent } from './usage';

const CONTROLS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first control after `el` in the page's order: where Tab would have gone next. */
function nextControlAfter(el: HTMLElement): HTMLElement | null {
  for (const x of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (el.contains(x) || !(el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
    if (x.getClientRects().length) return x;
  }
  return null;
}

export function UsageConsentTile() {
  const consent = useUsageConsent();
  const { toast } = useFints();
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  if (consent !== 'unasked') return null;

  const answer = (on: boolean) => {
    const box = ref.current;
    // The tile goes away with the answer; a keyboard user keeps their place.
    const next = box && box.contains(document.activeElement) ? nextControlAfter(box) : null;
    void setUsageConsent(on);
    toast(on ? 'Nutzungsdaten werden geteilt.' : 'Nutzungsdaten bleiben auf diesem Rechner.', on ? 'success' : 'info');
    if (next) focusFirst([next, document.getElementById('main')]);
  };

  return (
    <section ref={ref} aria-labelledby={titleId} className="panel px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-inset text-headline">
          <ChartIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="section-head">Nutzungsdaten teilen?</h2>
          <p className="mt-1 text-[14px] leading-snug text-ink-2">{USAGE_DISCLOSURE}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => answer(true)}>Teilen</Button>
            <Button size="sm" variant="secondary" onClick={() => answer(false)}>Nein danke</Button>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-ink-3">
            {ERROR_REPORTS_NOTE} Ändern kannst du das jederzeit im Sitzungsmenü oben rechts.
          </p>
        </div>
      </div>
    </section>
  );
}
