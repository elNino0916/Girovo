'use client';

// The closing edge of the page, in the masthead's navy. Nothing new is
// stated here: what the app is, how it reaches the bank, since when this
// session runs, and where its source lives — the shape every German bank
// closes an online-banking page with.

import { useFints } from '../FintsProvider';
import { ExternalIcon, ShieldIcon } from '../icons';
import { BrandMark } from './BrandMark';
import { fmtSince } from './session';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '';
const REPO = 'https://github.com/elNino0916/Girovo';

export function Footer() {
  const { bank, sessionStartedAt } = useFints();

  return (
    <footer className="on-bar mt-auto bg-bar text-bar-ink">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-7 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0">
            <BrandMark version={APP_VERSION} />
          </p>
          <nav aria-label="Projekt" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13.5px]">
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-sm font-semibold underline-offset-4 hover:underline"
            >
              Quellcode auf GitHub
              <ExternalIcon size={14} className="text-bar-ink-2" />
              <span className="sr-only">(öffnet extern)</span>
            </a>
            <span className="text-bar-ink-2">Open Source · MIT-Lizenz</span>
          </nav>
        </div>

        <div className="mt-5 flex flex-col gap-1.5 border-t border-bar-line pt-4 text-[13px] leading-snug text-bar-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {/* One sentence for how the app reaches the bank — it used to be
              said twice, once with the protocol and once without. */}
          <span className="inline-flex items-center gap-1.5">
            <ShieldIcon size={13} className="shrink-0" />
            Direkte FinTS-Verbindung von diesem Rechner zu {bank?.name || 'deiner Bank'}
          </span>
          <span className="sm:ml-auto">
            Angemeldet seit <span className="tnum">{fmtSince(sessionStartedAt)}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
