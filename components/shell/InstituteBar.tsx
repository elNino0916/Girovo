'use client';

// Tier 2 — the connected institute, the dashboard's sections, and the state
// of this device.
//
// The bank's mark lives here and only here, under the app's own masthead, so
// the two identities never compete. The tabs are the second-level navigation
// the reference puts in its white bar; on a phone they move to the bottom bar
// (thumb reach), and this tier keeps only the institute.

import type { DashboardTab } from '@/lib/app-types';
import { BankLogo } from '../BankLogo';
import { useFints } from '../FintsProvider';
import { ShieldIcon } from '../icons';
import { Tabs, Tag } from '../ui';

export const DASH_TABS_ID = 'dash';

export const TAB_ITEMS: { id: DashboardTab; label: string }[] = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'analysis', label: 'Analyse' },
  { id: 'contracts', label: 'Verträge & Abos' },
];

export function InstituteBar() {
  const { bank, logoFiles, deviceRemembered, tab, setTab } = useFints();
  const brand = bank?.brand || 'generic';

  // The white band and its rule span the window; the row inside is centred
  // beside the page scroller's scrollbar (--sbw, see Dashboard), the way the
  // page column below it is, so the bank's logo and the page title share an
  // edge.
  return (
    <div
      className="relative z-30 shrink-0 border-b border-line bg-surface"
      style={{ height: 'var(--subbar-h)', paddingRight: 'var(--sbw, 0px)' }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1280px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5 sm:max-w-[34%] desk:max-w-[40%]">
          <BankLogo brand={brand} size="sm" file={logoFiles[brand]} />
          <span className="min-w-0 truncate text-[14.5px] font-semibold text-ink" title={bank?.name}>
            {bank?.name || 'Keine Bank verbunden'}
          </span>
          {bank?.blz && (
            <span className="tnum hidden shrink-0 text-[12.5px] text-ink-3 desk:inline">BLZ {bank.blz}</span>
          )}
        </div>

        <span aria-hidden className="hidden h-6 w-px shrink-0 bg-line sm:block" />

        {/* The row is as tall as the bar so the active tab's rule sits on the
            bar's own bottom edge, the way the reference draws it. */}
        <div className="hidden min-w-0 self-stretch sm:flex">
          <Tabs
            idBase={DASH_TABS_ID}
            aria-label="Bereiche"
            items={TAB_ITEMS}
            value={tab}
            onChange={setTab}
          />
        </div>

        <div className="min-w-0 flex-1" />

        {deviceRemembered && (
          <Tag
            tone="info"
            icon={<ShieldIcon size={13} check />}
            title="Dieses Gerät ist gemerkt — die Bank fragt seltener nach einer TAN."
            className="max-[420px]:hidden"
          >
            Gerät gemerkt
          </Tag>
        )}
      </div>
    </div>
  );
}
