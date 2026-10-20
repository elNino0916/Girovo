'use client';

// The rows of the settings page (./Settings.tsx), and the two the Sitzung
// panel's list of banks shares with it (components/shell/ProfileMenu.tsx).
//
// The page is Material 3 Expressive's grouped list, as Android's own settings
// draw it: each section's rows stand together on a tonal ground of their own
// ([data-settings-group], app/material.css) — 2px apart, the group's outer
// corners round, the inner ones nearly square. Every row has the one shape:
// a glyph, the name, what it is or what it is set to, and at its end its
// control — a switch, the current value, or the chevron of a row that opens
// something. A row that opens something is pressed whole; what an action
// does in full is said by the dialog it opens, right before it is done.

import { useId } from 'react';
import type { ReactNode } from 'react';
import type { SettingsTarget } from '@/lib/app-types';
import { ChevronIcon, ExternalIcon } from '../icons';
import { Menu, MenuItemRadio, Switch, cx } from '../ui';

/** A section of the page: its name over its group of rows, and an optional note under them. */
export function SettingsGroup({
  title, setting, note, children,
}: { title: string; setting?: SettingsTarget; note?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-setting={setting}>
      <h2 id={id} className="px-4 pb-2 text-[14px] leading-5 font-medium tracking-[0.1px] text-accent">{title}</h2>
      <div data-settings-group>{children}</div>
      {note && <p className="px-4 pt-2 text-[13px] leading-snug text-ink-2">{note}</p>}
    </section>
  );
}

type ItemProps = {
  /** The row's glyph, drawn at 22px in the secondary ink. */
  icon?: ReactNode;
  title: ReactNode;
  /** What the setting is, or what it is set to: a line or two. */
  summary?: ReactNode;
  /** At the row's end: a value, a tag. A row that opens something gets its chevron by itself. */
  trailing?: ReactNode;
  /** A wide control or a state under the text (a segmented choice on a phone, a download's progress). */
  below?: ReactNode;
  setting?: SettingsTarget;
  /** The title in Soll Red: something here needs a look (the saved data cannot be read). */
  alert?: boolean;
  /** The on-device AI's row (Gemini Nano): washed in the tertiary colour, as Android marks its AI features. */
  tone?: 'ai';
};

const ITEM = 'flex min-h-14 w-full items-center gap-4 px-4 py-3 text-left';

function Glyph({ children }: { children: ReactNode }) {
  return <span aria-hidden className="grid size-6 shrink-0 place-items-center self-center text-ink-2 [&>svg]:size-[22px]">{children}</span>;
}

function Text({ title, titleId, summary, summaryId, below, alert }: {
  title: ReactNode; titleId?: string; summary?: ReactNode; summaryId?: string; below?: ReactNode; alert?: boolean;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span id={titleId} className={cx('block text-[15px] leading-snug', alert ? 'text-red' : 'text-ink')}>{title}</span>
      {summary && <span id={summaryId} className="mt-0.5 block text-[13px] leading-snug text-ink-2">{summary}</span>}
      {below}
    </span>
  );
}

/** A row that states something and offers nothing to press (the phone's integrity, the version). */
export function SettingItem({ icon, title, summary, trailing, below, setting, alert, tone }: ItemProps) {
  return (
    <div data-item data-setting={setting} data-tone={tone} className={ITEM}>
      {icon && <Glyph>{icon}</Glyph>}
      <Text title={title} summary={summary} below={below} alert={alert} />
      {trailing && <span className="shrink-0">{trailing}</span>}
    </div>
  );
}

/** A row pressed whole: it opens its dialog (or a page), and says so with its chevron. */
export function ActionItem({
  icon, title, summary, trailing, below, setting, alert, onClick, action, haspopup = 'dialog',
}: ItemProps & {
  onClick: () => void;
  /** What a press does, for a screen reader, where the title names a state ("Gerät gemerkt" → "Vergessen …"). */
  action?: string;
  haspopup?: 'dialog' | false;
}) {
  return (
    <button
      type="button"
      data-item
      data-pressable
      data-setting={setting}
      aria-haspopup={haspopup || undefined}
      onClick={onClick}
      className={ITEM}
    >
      {icon && <Glyph>{icon}</Glyph>}
      <Text
        title={action ? <>{title}<span className="sr-only">{`: ${action}`}</span></> : title}
        summary={summary}
        below={below}
        alert={alert}
      />
      {trailing && <span className="shrink-0">{trailing}</span>}
      <ChevronIcon dir="right" size={18} className="-mr-1 shrink-0 text-ink-2" />
    </button>
  );
}

/** A page outside the app, opened in the browser (electron/main.cjs sends it there). */
export function LinkItem({ icon, title, summary, href, opensExternally }: {
  icon?: ReactNode; title: ReactNode; summary?: ReactNode; href: string; opensExternally: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-item data-pressable className={ITEM}>
      {icon && <Glyph>{icon}</Glyph>}
      <Text title={<>{title}<span className="sr-only">{` ${opensExternally}`}</span></>} summary={summary} />
      <ExternalIcon size={16} className="shrink-0 text-ink-2" />
    </a>
  );
}

/**
 * A setting that is on or off. The whole row is the switch's label, so a
 * press anywhere on it turns it; the summary is the switch's description.
 */
export function SwitchItem({
  icon, title, summary, below, setting, checked, onChange, disabled,
}: ItemProps & { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const id = useId();
  const switchId = `sw${id}`;
  const summaryId = summary ? `${switchId}-sum` : undefined;
  return (
    <div data-item data-pressable={disabled ? undefined : ''} data-setting={setting} className={cx(ITEM, 'relative')}>
      {icon && <Glyph>{icon}</Glyph>}
      <span className="min-w-0 flex-1">
        {/* Its ::after covers the row: the label's press is the row's. */}
        <label
          htmlFor={switchId}
          className={cx(
            'block text-[15px] leading-snug text-ink after:absolute after:inset-0 after:content-[""]',
            disabled ? 'cursor-not-allowed text-ink-2' : 'cursor-pointer',
          )}
        >
          {title}
        </label>
        {summary && <span id={summaryId} className="mt-0.5 block text-[13px] leading-snug text-ink-2">{summary}</span>}
        {below && <span className="relative z-10 block">{below}</span>}
      </span>
      <Switch
        id={switchId}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        describedBy={summaryId}
        className="relative z-10"
      />
    </div>
  );
}

/**
 * One of a few values: the row names the setting and says its value at its
 * end; a press opens Material's menu of the choices, the chosen one checked.
 */
export function ChoiceItem<T extends string | number>({
  icon, title, summary, setting, value, choices, onChange,
}: Omit<ItemProps, 'trailing' | 'below'> & {
  value: T;
  choices: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  const current = choices.find((c) => c.value === value);
  return (
    <Menu
      placement="bottom-end"
      minWidth={160}
      trigger={(props) => (
        <button type="button" data-item data-pressable data-setting={setting} {...props} className={ITEM}>
          {icon && <Glyph>{icon}</Glyph>}
          <Text title={title} summary={summary} />
          <span className="flex shrink-0 items-center gap-1.5 text-[14px] leading-snug text-ink-2">
            {current?.label}
            <ChevronIcon size={16} />
          </span>
        </button>
      )}
    >
      {choices.map((c) => (
        <MenuItemRadio key={c.value} checked={c.value === value} onSelect={() => onChange(c.value)}>
          {c.label}
        </MenuItemRadio>
      ))}
    </Menu>
  );
}

/**
 * A choice of two or three shown at once (Sprache, Darstellung): Material's
 * connected buttons at the row's end — under its name on a phone, where both
 * would not fit one line.
 */
export function SegmentedItem({
  icon, title, summary, setting, wide, children,
}: Omit<ItemProps, 'trailing' | 'below'> & { wide?: boolean; children: ReactNode }) {
  return (
    <div data-item data-setting={setting} className={cx(ITEM, 'flex-wrap gap-y-3')}>
      {icon && <Glyph>{icon}</Glyph>}
      <Text title={title} summary={summary} />
      {/* Under the name (on the text's edge) once the row is too narrow for both. */}
      <span
        className={cx(
          'shrink-0',
          wide ? 'max-sm:ml-10 max-sm:basis-full' : 'max-[359.98px]:ml-10 max-[359.98px]:basis-full',
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** A row that opens something: Updates, Tastenkürzel (the Sitzung panel's way to Einstellungen too). */
export const ROW = '-mx-1.5 min-h-10 items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink hover:bg-inset';

/** A fact about this machine with its one action: a bank of the view, in the Sitzung panel. */
export function MachineRow({
  icon, title, hint, action, setting,
}: { icon: ReactNode; title: string; hint: string; action?: ReactNode; setting?: SettingsTarget }) {
  return (
    <div data-setting={setting} className="mt-3 flex items-center gap-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{hint}</p>
      </div>
      {action}
    </div>
  );
}
