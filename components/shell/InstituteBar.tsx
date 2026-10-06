'use client';

// Tier 2 — the connected institute, the dashboard's sections, and the state
// of this device.
//
// The bank's mark lives here and only here, under the app's own masthead, so
// the two identities never compete. The tabs are the second-level navigation
// the reference puts in its white bar; on a phone they move to the bottom bar
// (thumb reach), and this tier keeps only the institute.

import type { DashboardTab } from '@/lib/app-types';
import { rich, useT } from '@/lib/i18n/react';
import { fmtBlz } from '../auth/format';
import { BankLogo } from '../BankLogo';
import { useFints } from '../FintsProvider';
import { ShieldIcon } from '../icons';
import { Tabs, Tag } from '../ui';

export const DASH_TABS_ID = 'dash';

/** The sections, in order. Each is named where it is shown, by the navigation's word (t.common.nav). */
export const TAB_ITEMS: { id: DashboardTab }[] = [{ id: 'overview' }, { id: 'analysis' }, { id: 'contracts' }];

export function InstituteBar() {
  const { bank, logoFiles, deviceRemembered, tab, setTab } = useFints();
  const t = useT();
  const brand = bank?.brand || 'generic';

  // The white band and its rule span the window; the row inside is centred
  // beside the page scroller's scrollbar (--sbw, see Dashboard), the way the
  // page column below it is, so the bank's logo and the page title share an
  // edge.
  //
  // When room runs out (a narrow or zoomed window) things give way in order
  // of importance: first the "Gerät gemerkt" tag drops its words for its
  // shield, then the bank's name truncates. The section tabs never do — they
  // are where the user goes, the other two only say how things stand. The
  // room is the row's own (a container query), not the window's.
  return (
    <div
      className="relative z-30 shrink-0 border-b border-line bg-surface"
      style={{ height: 'var(--subbar-h)', paddingRight: 'var(--sbw, 0px)' }}
    >
      <div className="@container/ibar mx-auto h-full w-full max-w-[1280px] px-4 sm:px-6">
        <div className="flex h-full items-center gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:max-w-[34%] desk:max-w-[40%]">
            <BankLogo brand={brand} size="sm" file={logoFiles[brand]} />
            <span className="min-w-0 truncate text-[14.5px] font-semibold text-ink" title={bank?.name}>
              {bank?.name || t.shell.instituteBar.noBank}
            </span>
            {/* Read digit by digit against a statement or a letter: Plex
                Mono, grouped the way the login screen prints it. */}
            {bank?.blz && (
              <span className="hidden shrink-0 text-[12.5px] whitespace-nowrap text-ink-3 desk:inline">
                {rich(t.shell.instituteBar.blz(<span className="num">{fmtBlz(bank.blz)}</span>))}
              </span>
            )}
          </div>

          <span aria-hidden className="hidden h-6 w-px shrink-0 bg-line sm:block" />

          {/* The row is as tall as the bar so the active tab's rule sits on the
              bar's own bottom edge, the way the reference draws it. */}
          <div className="hidden shrink-0 self-stretch sm:flex">
            <Tabs
              idBase={DASH_TABS_ID}
              aria-label={t.shell.instituteBar.sections}
              items={TAB_ITEMS.map(({ id }) => ({ id, label: t.common.nav[id] }))}
              value={tab}
              onChange={setTab}
            />
          </div>

          <div className="min-w-0 flex-1" />

          {deviceRemembered && (
            <Tag
              tone="info"
              icon={<ShieldIcon size={13} check />}
              title={t.shell.instituteBar.deviceHint}
              className="max-[420px]:hidden @max-[48rem]/ibar:px-1.5"
            >
              <span className="@max-[48rem]/ibar:sr-only">{t.shell.instituteBar.device}</span>
            </Tag>
          )}
        </div>
      </div>
    </div>
  );
}
