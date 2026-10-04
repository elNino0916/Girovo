'use client';

import { useState } from 'react';
import type { DateRange, StatementInfo } from '@/lib/app-types';
import { fmtRange, isoDate, presetRange, type RangePreset } from '@/lib/format';
import { CalendarIcon, ChevronIcon } from '../icons';
import {
  Alert, Button, DialogActions, Field, Input, Menu, MenuGroup, MenuItem, MenuItemRadio, MenuSeparator, Popover, cx,
} from '../ui';

const PRESETS: { id: RangePreset; label: string; short: string }[] = [
  { id: '30d', label: 'Letzte 30 Tage', short: '30 Tage' },
  { id: '90d', label: 'Letzte 90 Tage', short: '90 Tage' },
  { id: 'thisMonth', label: 'Dieser Monat', short: 'Dieser Monat' },
  { id: 'lastMonth', label: 'Letzter Monat', short: 'Letzter Monat' },
  { id: 'thisYear', label: 'Dieses Jahr', short: 'Dieses Jahr' },
  { id: '365d', label: 'Letzte 12 Monate', short: '12 Monate' },
];

/**
 * PSD2 lets a bank skip the approval for the last 90 days of bookings;
 * reaching further back is what usually costs one. So the hint is shown
 * wherever a choice reaches further back than what is loaded — honestly
 * hedged, because some banks ask anyway and some never do.
 */
const MAY_NEED_TAN = 'Kann eine Freigabe erfordern';

/**
 * Which period the Umsätze list asks the bank for: presets in a menu, and a
 * custom range in a small popover behind "Eigener Zeitraum …". Both apply
 * through `applyRange`, which re-reads the active account — so the control is
 * shut while another bank operation runs.
 *
 * What is shown as selected is what was actually loaded (`loaded`), never
 * the control's own state.
 */
export function PeriodControl({
  loaded, applyRange, busy,
}: {
  loaded: StatementInfo | undefined;
  applyRange: (r: DateRange) => void;
  busy: boolean;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const today = isoDate(new Date());
  const active = loaded ? PRESETS.find((p) => {
    const r = presetRange(p.id);
    return r.from === loaded.from && r.to === loaded.to;
  }) : undefined;
  const reachesBack = (from: string) => !loaded || from < loaded.from;
  const label = active ? active.short : 'Zeitraum';
  const describe = loaded ? `Zeitraum: ${active ? active.label : fmtRange(loaded.from, loaded.to)}` : 'Zeitraum wählen';

  return (
    <Popover
      open={customOpen}
      onOpenChange={setCustomOpen}
      label="Eigener Zeitraum"
      placement="bottom-end"
      trigger={(pop) => (
        <Menu
          label="Zeitraum"
          placement="bottom-end"
          minWidth={264}
          // A menu opening on the same button means the popover is done.
          onOpenChange={(open) => { if (open) setCustomOpen(false); }}
          trigger={(menu, { open }) => {
            // One button anchors both layers: its ref is handed to each.
            const ref = (el: HTMLElement | null) => { menu.ref(el); pop.ref(el); };
            return (
              <Button
                {...menu}
                ref={ref}
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={describe}
                title={busy ? 'Bitte warten – ein anderer Vorgang läuft noch.' : undefined}
                iconLeft={<CalendarIcon size={16} />}
                iconRight={<ChevronIcon size={14} strokeWidth={2} className={cx('-mr-1 transition-transform duration-150', open && 'rotate-180')} />}
                className="max-sm:px-3"
              >
                {/* On a phone the dates under the title already say it. */}
                <span className="hidden sm:inline">{label}</span>
              </Button>
            );
          }}
        >
          <MenuGroup label="Zeitraum laden">
            {PRESETS.map((p) => {
              const r = presetRange(p.id);
              return (
                <MenuItemRadio
                  key={p.id}
                  checked={active?.id === p.id}
                  description={
                    <>
                      <span className="tnum block">{fmtRange(r.from, r.to)}</span>
                      {reachesBack(r.from) && <span className="block">{MAY_NEED_TAN}</span>}
                    </>
                  }
                  onSelect={() => { if (active?.id !== p.id) applyRange(r); }}
                >
                  {p.label}
                </MenuItemRadio>
              );
            })}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem
            icon={<CalendarIcon />}
            description={!active && loaded ? fmtRange(loaded.from, loaded.to) : undefined}
            onSelect={() => setCustomOpen(true)}
          >
            Eigener Zeitraum …
          </MenuItem>
        </Menu>
      )}
    >
      {(close) => (
        <CustomRange
          initial={loaded ?? presetRange('90d')}
          loadedFrom={loaded?.from}
          today={today}
          busy={busy}
          onApply={(r) => {
            applyRange(r);
            close();
          }}
          onCancel={close}
        />
      )}
    </Popover>
  );
}

function CustomRange({
  initial, loadedFrom, today, busy, onApply, onCancel,
}: {
  initial: DateRange;
  loadedFrom: string | undefined;
  today: string;
  busy: boolean;
  onApply: (r: DateRange) => void;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to > today ? today : initial.to);

  // Validated as typed, but only once both ends are real dates: a half-typed
  // year is not an error yet.
  const complete = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const fromError = complete && from > to ? 'Der Beginn liegt nach dem Ende.' : from > today ? 'Der Beginn liegt in der Zukunft.' : undefined;
  const toError = to > today ? 'Höchstens bis heute.' : undefined;
  const valid = complete && !fromError && !toError;
  // Re-applying what is already loaded would only cost a bank round-trip.
  const unchanged = !!loadedFrom && from === initial.from && to === initial.to;

  return (
    <form
      className="w-[min(304px,calc(100vw-48px))]"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onApply({ from, to });
      }}
    >
      <p className="mb-3 text-[16px] font-bold text-headline">Eigener Zeitraum</p>
      <Field label="Von" error={fromError} className="mb-3">
        <Input type="date" value={from} max={to && to < today ? to : today} onChange={(e) => setFrom(e.target.value)} data-autofocus />
      </Field>
      <Field label="Bis" error={toError} className="mb-3">
        <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
      </Field>
      {valid && loadedFrom && from < loadedFrom && (
        <Alert tone="info" className="mt-1" role="status">
          {MAY_NEED_TAN}. Manche Banken liefern weniger Verlauf.
        </Alert>
      )}
      <DialogActions className="mt-4">
        <Button size="sm" variant="secondary" onClick={onCancel}>Abbrechen</Button>
        <Button size="sm" variant="primary" type="submit" disabled={!valid || busy || unchanged}>Übernehmen</Button>
      </DialogActions>
    </form>
  );
}
