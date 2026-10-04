'use client';

// The interface primitives. Every control in the app is built from these, so a
// focus ring, a hit area, a keyboard contract or a colour role is decided once
// here and cannot drift between screens.
//
// Conventions that hold for everything below:
// - Action blue (accent) is the only interactive colour. Navy is chrome.
// - Pills for buttons, 8px chips for filters, 6px fields, 12px tiles, 16px
//   sheets. Sentence-case labels.
// - Anything that opens on top of the page (Overlay, Menu, Popover) renders in
//   place — never portalled out of the tree — so it stays inside app/page.tsx's
//   print:hidden wrapper and never reaches paper.
// - `cx` is a plain join, not a merge: a component never relies on a caller's
//   class overriding one of its own. Where a caller needs to change spacing,
//   the component takes the margin off when a className is given.

import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import type {
  ComponentProps, CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent,
  ReactNode, RefCallback, RefObject,
} from 'react';
import { anchorPosition, type Placement } from '@/lib/anchor';
import { copyText } from '@/lib/clipboard';
import { setCaptionDim } from '@/lib/theme';
import {
  AlertTriangleIcon, CheckCircleIcon, CheckIcon, ChevronIcon, CloseIcon, CopyIcon, InfoIcon, XCircleIcon,
} from './icons';

// Re-exported so screens written against the old single-module API keep
// importing their icons from here.
export {
  ArrowRightIcon, ChevronIcon, ClockIcon, CloseIcon, PowerIcon, RefreshIcon, SearchIcon, ShieldIcon, UserIcon,
} from './icons';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/** Electron: a layer over the masthead must not be a window-drag handle. */
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as CSSProperties;

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
export type ButtonVariant =
  | 'primary' | 'secondary' | 'tertiary' | 'quiet' | 'bar' | 'stage' | 'stage-primary' | 'danger'
  /** @deprecated the old outline button — same as `secondary`. */
  | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm' | 'xs';

export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  /** lg 48 · md 44 · sm 36 · xs 30 px tall. */
  size?: ButtonSize;
  block?: boolean;
  /** Shows a spinner, disables the button and marks it aria-busy. The label stays. */
  busy?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

// Labels are semibold, not bold: Google Sans Flex at 700 thickens into a
// slab at 13–15px, and a row of pills then out-shouts the headline it serves.
// 700 is kept for what names a thing (dialog, tile and drawer titles).
const BUTTON_BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out ' +
  'disabled:cursor-not-allowed disabled:opacity-45';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-2 border-transparent bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-press disabled:hover:bg-accent',
  secondary:
    'border-2 border-accent text-accent hover:bg-accent-soft active:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] disabled:hover:bg-transparent',
  ghost:
    'border-2 border-accent text-accent hover:bg-accent-soft active:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] disabled:hover:bg-transparent',
  tertiary: 'border-2 border-transparent text-accent hover:bg-accent-soft active:bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]',
  quiet: 'border-2 border-transparent text-ink-2 hover:bg-inset hover:text-ink',
  /* On the navy masthead, where the page's borders and hovers would vanish.
     Never taller than the band allows (--band-ctl, see globals.css). */
  bar:
    'max-h-[var(--band-ctl)] border-[1.5px] border-bar-line text-bar-ink hover:border-bar-ink-2 hover:bg-[color-mix(in_srgb,var(--bar-ink)_12%,transparent)]',
  /* On the navy stage band: white outline, and a filled white for the one
     action the stage leads with. */
  stage:
    'border-[1.5px] border-stage-line text-stage-ink hover:border-stage-ink hover:bg-[color-mix(in_srgb,var(--stage-ink)_12%,transparent)]',
  'stage-primary':
    'border-2 border-transparent bg-stage-ink text-stage hover:bg-[color-mix(in_srgb,var(--stage-ink)_86%,var(--stage))]',
  danger: 'border-2 border-transparent bg-red text-red-ink hover:bg-[color-mix(in_srgb,var(--red)_86%,black)]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  lg: 'h-12 gap-2.5 px-6 text-[15px]',
  md: 'h-11 gap-2 px-5 text-[14px]',
  sm: 'h-9 gap-1.5 px-4 text-[13.5px]',
  xs: 'h-[30px] gap-1.5 px-3 text-[13px]',
};

export function Button({
  variant = 'secondary', size = 'md', block, busy, iconLeft, iconRight, className, children, disabled, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], block && 'w-full', className)}
      {...rest}
    >
      {busy ? <Spinner size={size === 'lg' ? 17 : 15} /> : iconLeft}
      {children}
      {iconRight}
    </button>
  );
}

export function Spinner({ className, size = 15, label }: { className?: string; size?: number; label?: string }) {
  const ring = (
    <span
      aria-hidden
      className={cx('inline-block shrink-0 rounded-full border-2 border-current border-t-transparent', className)}
      style={{ width: size, height: size, animation: 'spin .7s linear infinite' }}
    />
  );
  if (!label) return ring;
  return (
    <span role="status" className="inline-flex items-center">
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export type IconButtonProps = ComponentProps<'button'> & {
  tone?: 'page' | 'bar' | 'stage';
  /** sm 32 · md 40 px. */
  size?: 'sm' | 'md';
  /** A glyph says nothing to a screen reader; the name is not optional. */
  'aria-label': string;
};

const ICON_TONES = {
  page: 'text-ink-2 hover:bg-inset hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent',
  bar: 'text-bar-ink-2 hover:bg-[color-mix(in_srgb,var(--bar-ink)_12%,transparent)] hover:text-bar-ink aria-pressed:text-bar-ink',
  stage: 'text-stage-ink-2 hover:bg-[color-mix(in_srgb,var(--stage-ink)_12%,transparent)] hover:text-stage-ink',
} as const;

export function IconButton({
  className, tone = 'page', size = 'sm', type = 'button', title, children, ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      // The name doubles as the hover tooltip, so a bare icon is never a guess.
      title={title ?? rest['aria-label']}
      className={cx(
        'grid shrink-0 place-items-center rounded-full transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'md' ? 'size-10' : 'size-8',
        // A bar's controls live in a caption band, which page zoom shrinks
        // in the desktop shell (--band-ctl, see globals.css); max-* rather
        // than a size so it wins whatever the order of the classes.
        tone === 'bar' && 'max-h-[var(--band-ctl)] max-w-[var(--band-ctl)]',
        ICON_TONES[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Copies a value and says so — a check for 1.6 s and a polite announcement.
 * Goes through copyText, which also works under the desktop shell's
 * clipboard policy.
 */
export function CopyButton({
  text, label = 'Kopieren', tone = 'page', className,
}: { text: string; label?: string; tone?: 'page' | 'bar' | 'stage'; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'done' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  };

  return (
    <span className="relative inline-flex">
      <IconButton tone={tone} aria-label={label} onClick={() => void copy()} className={className}>
        {state === 'done' ? (
          <CheckIcon size={16} strokeWidth={2.2} className={tone === 'page' ? 'text-green' : undefined} />
        ) : state === 'failed' ? (
          <XCircleIcon size={16} className={tone === 'page' ? 'text-red' : undefined} />
        ) : (
          <CopyIcon size={16} />
        )}
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {state === 'done' ? 'Kopiert' : state === 'failed' ? 'Kopieren nicht möglich' : ''}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form
//
// A Field hands its id, its hint/error ids and its invalid state to the one
// control inside it through context, so `<Field label error><Input/></Field>`
// is fully wired for a screen reader without the caller threading ids.
// ---------------------------------------------------------------------------
type FieldWiring = { id: string; describedBy?: string; invalid: boolean; required: boolean };
const FieldContext = createContext<FieldWiring | null>(null);

function useFieldWiring(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: unknown; invalid?: boolean }) {
  const f = useContext(FieldContext);
  const invalid = !!props.invalid || props['aria-invalid'] === true || props['aria-invalid'] === 'true' || !!f?.invalid;
  return {
    id: props.id ?? f?.id,
    'aria-describedby': cx(props['aria-describedby'], f?.describedBy) || undefined,
    'aria-invalid': invalid || undefined,
    'aria-required': f?.required || undefined,
  };
}

export function Field({
  label, htmlFor, hint, error, required, optional, trailing, labelHidden, className, children,
}: {
  label: ReactNode;
  /** The control's id. Generated when omitted (and handed to the control). */
  htmlFor?: string;
  hint?: ReactNode;
  /** Shown under the control in red, linked via aria-describedby; marks it invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Says "(optional)" after the label — for forms where most fields are required. */
  optional?: boolean;
  /** Sits at the right end of the label row. */
  trailing?: ReactNode;
  /** Keeps the label for screen readers only. */
  labelHidden?: boolean;
  /** Replaces the default bottom margin. */
  className?: string;
  children: ReactNode;
}) {
  const auto = useId();
  const id = htmlFor ?? `field${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const wiring = useMemo<FieldWiring>(
    () => ({ id, describedBy: cx(errorId, hintId) || undefined, invalid: !!error, required: !!required }),
    [id, errorId, hintId, error, required],
  );

  return (
    <div className={cx('flex flex-col gap-1.5', className ?? 'mb-4')}>
      <div className={cx('flex items-baseline justify-between gap-3', labelHidden && !trailing && 'sr-only')}>
        <label htmlFor={id} className={cx('text-[13px] leading-snug font-semibold text-ink-2', labelHidden && 'sr-only')}>
          {label}
          {required && <span aria-hidden className="ml-0.5 text-ink-3">*</span>}
          {optional && <span className="font-normal text-ink-3"> (optional)</span>}
        </label>
        {trailing}
      </div>
      <FieldContext.Provider value={wiring}>{children}</FieldContext.Provider>
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-[13.5px] leading-snug font-semibold text-red">
          <AlertTriangleIcon size={16} className="mt-px" />
          <span>{error}</span>
        </p>
      )}
      {hint && <div id={hintId} className="text-[13px] leading-snug text-ink-3">{hint}</div>}
    </div>
  );
}

const CONTROL_BASE =
  'w-full rounded-[var(--radius-field)] border border-field-line bg-field-bg text-[16px] text-ink ' +
  'transition-[border-color,background-color] duration-150 hover:border-ink-3 ' +
  'aria-invalid:border-red aria-invalid:hover:border-red ' +
  'disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-inset disabled:text-ink-3';

// Text controls only: a <select> always matches :read-only, so this cannot
// live in the shared base.
const TEXT_READONLY = 'read-only:bg-inset';

export type InputProps = ComponentProps<'input'> & {
  invalid?: boolean;
  /** Decorative mark inside the left edge (search glyph, currency). */
  leading?: ReactNode;
  /** Inside the right edge; may be interactive (a reveal toggle, a clear button). */
  trailing?: ReactNode;
  containerClassName?: string;
};

export function Input({ className, invalid, leading, trailing, containerClassName, ...rest }: InputProps) {
  const wiring = useFieldWiring({ ...rest, invalid });
  const input = (
    <input
      {...rest}
      {...wiring}
      className={cx(
        CONTROL_BASE,
        TEXT_READONLY,
        'h-12',
        leading ? 'pl-10' : 'pl-3.5',
        trailing ? 'pr-12' : 'pr-3.5',
        className,
      )}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cx('relative', containerClassName ?? 'w-full')}>
      {input}
      {leading && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">
          {leading}
        </span>
      )}
      {trailing && <span className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</span>}
    </div>
  );
}

export type SelectProps = ComponentProps<'select'> & { invalid?: boolean; containerClassName?: string };

export function Select({ className, children, invalid, containerClassName, ...rest }: SelectProps) {
  const wiring = useFieldWiring({ ...rest, invalid });
  // One grid cell for the select and its chevron, so the chevron follows the
  // select's own width whatever the caller sizes it to.
  return (
    <div className={cx('grid', containerClassName ?? 'w-full')}>
      <select
        {...rest}
        {...wiring}
        className={cx(CONTROL_BASE, 'col-start-1 row-start-1 h-12 cursor-pointer appearance-none pr-10 pl-3.5', className)}
      >
        {children}
      </select>
      <ChevronIcon
        size={16}
        strokeWidth={2}
        className="pointer-events-none col-start-1 row-start-1 mr-3.5 self-center justify-self-end text-ink-3"
      />
    </div>
  );
}

export type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean; showCount?: boolean };

export function Textarea({ className, invalid, showCount, maxLength, value, ...rest }: TextareaProps) {
  const wiring = useFieldWiring({ ...rest, invalid });
  const count = typeof value === 'string' ? value.length : null;
  return (
    <>
      <textarea
        {...rest}
        {...wiring}
        value={value}
        maxLength={maxLength}
        className={cx(CONTROL_BASE, TEXT_READONLY, 'block min-h-[96px] resize-y px-3.5 py-3 leading-[1.45]', className)}
      />
      {showCount && maxLength != null && count != null && (
        <span className="tnum self-end text-[12.5px] text-ink-3" aria-hidden>
          {count}/{maxLength}
        </span>
      )}
    </>
  );
}

export function Checkbox({
  label, description, className, disabled, ...input
}: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode; description?: ReactNode }) {
  const auto = useId();
  const descId = description ? `cb${auto}-desc` : undefined;
  return (
    <label
      className={cx(
        'inline-flex items-start gap-3 py-1 text-[15px] leading-snug text-ink',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative mt-px grid size-5 shrink-0 place-items-center">
        <input
          type="checkbox"
          disabled={disabled}
          aria-describedby={descId}
          className={cx(
            'peer col-start-1 row-start-1 size-5 cursor-[inherit] appearance-none rounded-[5px] border-[1.5px] border-field-line bg-field-bg',
            'transition-colors duration-150 hover:border-ink-3 checked:border-accent checked:bg-accent checked:hover:border-accent-hover checked:hover:bg-accent-hover',
          )}
          {...input}
        />
        <CheckIcon
          size={14}
          strokeWidth={2.8}
          className="pointer-events-none col-start-1 row-start-1 text-accent-ink opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {description && <span id={descId} className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({
  checked, onChange, label, description, disabled, id, className, 'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label; without it, pass aria-label. */
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const auto = useId();
  const switchId = id ?? `sw${auto}`;
  const descId = description ? `${switchId}-desc` : undefined;
  const control = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={descId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150',
        checked ? 'bg-accent hover:bg-accent-hover' : 'bg-field-line hover:bg-ink-3',
        'disabled:cursor-not-allowed disabled:opacity-45',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.25)] transition-transform duration-150',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <span className="min-w-0">
        <label htmlFor={switchId} className={cx('block text-[15px] leading-snug text-ink', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {label}
        </label>
        {description && <span id={descId} className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}
      </span>
      {control}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert — an inline message inside a form or a tile.
// ---------------------------------------------------------------------------
export type AlertTone = 'error' | 'warn' | 'info' | 'success';

const ALERT_TONES: Record<AlertTone, { box: string; icon: string; Glyph: typeof InfoIcon }> = {
  error: { box: 'bg-red-soft shadow-[inset_3px_0_0_var(--red)]', icon: 'text-red', Glyph: AlertTriangleIcon },
  // Amber is reserved for "vorgemerkt", so a warning is the neutral inset with
  // the orange emphasis mark — the colour is only a pointer; the words carry it.
  warn: { box: 'bg-inset shadow-[inset_3px_0_0_var(--emphasis)]', icon: 'text-emphasis', Glyph: AlertTriangleIcon },
  info: { box: 'bg-info-soft shadow-[inset_3px_0_0_var(--info)]', icon: 'text-info', Glyph: InfoIcon },
  success: { box: 'bg-green-soft shadow-[inset_3px_0_0_var(--green)]', icon: 'text-green', Glyph: CheckCircleIcon },
};

export function Alert({
  tone = 'error', title, children, action, onDismiss, icon, className, role,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  icon?: ReactNode;
  /** Replaces the default top margin. */
  className?: string;
  /** Defaults to "alert" for errors, none otherwise. */
  role?: 'alert' | 'status';
}) {
  const t = ALERT_TONES[tone];
  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : undefined)}
      className={cx('flex items-start gap-3 rounded-[8px] py-3 pr-3 pl-4 text-[14px] leading-snug text-ink', t.box, className ?? 'mt-3')}
    >
      <span className={cx('mt-px shrink-0', t.icon)}>{icon ?? <t.Glyph size={18} />}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cx(title ? 'mt-0.5 text-ink-2' : undefined)}>{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <IconButton aria-label="Hinweis schließen" onClick={onDismiss} className="-my-1 -mr-1 size-7">
          <CloseIcon size={15} />
        </IconButton>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlays
//
// One Overlay underlies every modal surface — centred dialog, bottom sheet,
// right drawer. It owns the contract a modal must keep: focus moves in and is
// trapped, Escape closes the topmost layer only, focus returns to whatever
// opened it, and the page behind stops scrolling.
// ---------------------------------------------------------------------------

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), iframe, audio[controls], video[controls], summary, ' +
  '[contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

const isShown = (el: HTMLElement) => el.getClientRects().length > 0 && !el.closest('[inert], [hidden]');

/**
 * In the Tab order: tabindex="-1" leaves a control out of it — the unchecked
 * radios of a roving group (Segmented), the items of a menu. Those take
 * focus from their own keys, never from Tab or from a layer opening.
 */
const isTabbable = (el: HTMLElement) => el.getAttribute('tabindex') !== '-1';

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => isShown(el) && isTabbable(el));
}

/** A field to type into: typing is never consequential, so a form may open there. Not a checkbox, switch or select. */
const TEXT_FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"])'
  + ':not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * Where focus goes when a layer opens: the safe, non-destructive place. One
 * rule for every dialog, drawer, sheet and popover:
 *
 *   1. what the layer names — `initialFocus`, or [data-autofocus] on its safe
 *      button ("Abbrechen", "Weiter warten", "Angemeldet bleiben");
 *   2. else its first field to type into (a form starts where you type);
 *   3. else its own close button (a drawer of details: Enter only closes);
 *   4. else the layer itself, which a screen reader announces by its name.
 *
 * Never a checkbox, a switch, a radio, an external link or an action button
 * by default: the first Space or Enter after opening must not arm a data
 * wipe, shorten the auto-logout, switch update checks off — or start a
 * transfer from a booking's "Erneut überweisen".
 */
function safeFocusTarget(root: HTMLElement, named?: HTMLElement | null): HTMLElement {
  const usable = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && isShown(el) && !el.matches(':disabled');
  if (usable(named)) return named;
  const marked = root.querySelector<HTMLElement>('[data-autofocus]');
  if (usable(marked)) return marked;
  const field = focusablesIn(root).find((el) => el.matches(TEXT_FIELD) && !el.matches(':disabled'));
  if (field) return field;
  const close = root.querySelector<HTMLElement>('[data-dialog-close]');
  if (usable(close)) return close;
  return root;
}

/**
 * Focus was put somewhere with preventScroll (the layer must not jump while
 * it animates in), so a target below the fold of its scrolling body — a
 * dialog's buttons on a short window — is brought into view here, inside the
 * layer only. A focused control nobody can see is a lost place (WCAG 2.4.11).
 */
function revealInLayer(el: HTMLElement, root: HTMLElement) {
  let scroller = el.parentElement;
  while (scroller && scroller !== root) {
    const overflow = getComputedStyle(scroller).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  if (!scroller || scroller === root) return;
  const r = el.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const air = 12;
  if (r.bottom > box.bottom) scroller.scrollTop += r.bottom - box.bottom + air;
  else if (r.top < box.top) scroller.scrollTop -= box.top - r.top + air;
}

/**
 * Moves focus to the first candidate still on the page and showing. A
 * heading or a landmark is given tabindex="-1" on the way, so it can take
 * focus without joining the Tab order. True once focus has moved.
 */
export function focusFirst(candidates: Iterable<HTMLElement | null | undefined>): boolean {
  for (const el of candidates) {
    if (!el?.isConnected || !isShown(el) || el.matches(':disabled')) continue;
    if (!el.matches(FOCUSABLE) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/**
 * The controls just after and just before `el` in the page's Tab order,
 * outside `layer` — the user's place, should `el` itself be gone by the time
 * the layer closes. Read when the layer opens, while `el` is still there.
 */
function neighboursOf(el: Element | null, layer: HTMLElement): HTMLElement[] {
  if (!(el instanceof HTMLElement) || !el.isConnected) return [];
  const before: HTMLElement[] = [];
  let next: HTMLElement | undefined;
  for (const x of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (x === el || el.contains(x) || layer.contains(x) || !isTabbable(x)) continue;
    if (el.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_PRECEDING) before.push(x);
    else if (isShown(x)) {
      next = x;
      break;
    }
  }
  const prev = before.reverse().find(isShown);
  return [next, prev].filter((x): x is HTMLElement => !!x);
}

// Modal layers currently open, innermost last. Only the top one answers
// Escape and Tab, so a confirm over a sheet closes the confirm, not both.
const layerStack: string[] = [];
const layerRoots = new Map<string, HTMLElement>();
// The layers that are right-hand drawers (see syncCaptionDim).
const drawerLayers = new Set<string>();

/**
 * Every layer lays the scrim over the whole page, masthead included — but
 * the desktop shell's caption buttons are drawn by the OS above the page,
 * where no scrim reaches, and would stay a bright navy block in the darkened
 * bar. So the shell is told how many scrims cover their corner and darkens
 * them to match (lib/theme.ts, electron/main.cjs): every layer above the
 * topmost drawer, whose own navy header sits in that corner undimmed.
 */
function syncCaptionDim() {
  let n = 0;
  for (let i = layerStack.length - 1; i >= 0 && !drawerLayers.has(layerStack[i]); i--) n++;
  setCaptionDim(n);
}

export type FocusFallback = RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined);

/**
 * Runs once a layer has closed and the page has settled. Focus that has
 * fallen to the body — the element it was to return to went away, often in
 * the very commit that closed the layer: a teaser that disappears once its
 * messages are read, a booking a new category filters out of the list — is
 * put back near the user's place: inside a layer still open, else the
 * caller's fallback, the opener's neighbours, the page's own fallback mark,
 * the page title, the main landmark. Never takes focus from anything that
 * has it (a layer opened on the next tick, a field).
 */
function recoverFocus(fallback: FocusFallback | undefined, neighbours: HTMLElement[]) {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const own = typeof fallback === 'function' ? fallback() : fallback?.current;
  const candidates = [
    own,
    ...neighbours,
    document.querySelector<HTMLElement>('[data-focus-fallback]'),
    // shell/Stage's PAGE_TITLE_ID: the open tab's h1.
    document.getElementById('page-title'),
    document.querySelector<HTMLElement>('main'),
  ];
  const top = layerRoots.get(layerStack[layerStack.length - 1] ?? '');
  if (!top) {
    focusFirst(candidates);
  } else if (!focusFirst(candidates.filter((el) => el && top.contains(el)))) {
    (focusablesIn(top)[0] ?? top).focus({ preventScroll: true });
  }
}

// The page scrolls inside the shell's container, not the window (the window
// is fixed under the desktop caption bar). Locking it means locking that
// container — the shell marks it [data-scroll-root] — and the body as well.
// Counted, so nested layers unlock only when the last one closes; the
// scrollbar's width is padded back in so the page does not jump sideways.
let lockDepth = 0;
let unlockPage: (() => void) | null = null;

function lockPageScroll() {
  if (lockDepth++ > 0) return;
  const targets = [document.body, ...Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-root]'))];
  const saved = targets.map((el) => {
    const bar = el === document.body
      ? window.innerWidth - document.documentElement.clientWidth
      : el.offsetWidth - el.clientWidth;
    const prev = { overflow: el.style.overflow, paddingRight: el.style.paddingRight };
    const pad = parseFloat(getComputedStyle(el).paddingRight) || 0;
    el.style.overflow = 'hidden';
    if (bar > 0) el.style.paddingRight = `${pad + bar}px`;
    return { el, prev };
  });
  unlockPage = () => {
    for (const { el, prev } of saved) {
      el.style.overflow = prev.overflow;
      el.style.paddingRight = prev.paddingRight;
    }
  };
}

function unlockPageScroll() {
  if (--lockDepth > 0) return;
  lockDepth = 0;
  unlockPage?.();
  unlockPage = null;
}

export type OverlayProps = {
  open: boolean;
  /** Escape and (unless onBackdrop says otherwise) a backdrop click. Omit for a layer that must not be dismissed. */
  onClose?: () => void;
  /** A backdrop click; defaults to onClose. Pass a no-op to keep a dirty form open. */
  onBackdrop?: () => void;
  /** center: dialog (a bottom sheet below 640px) · right: drawer · bottom: always a bottom sheet. */
  align?: 'center' | 'right' | 'bottom';
  labelledBy?: string;
  describedBy?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  /** Where focus goes on open. Defaults to the safe place (see safeFocusTarget): [data-autofocus], a field, the close button, the layer. */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Where focus goes on close. Defaults to whatever had focus when the layer
   * opened — pass the real opener when the layer can be re-mounted from
   * somewhere else (a sheet that steps aside for the TAN dialog and comes back).
   */
  returnFocus?: Element | null;
  /**
   * Where focus goes on close when that element is no longer on the page —
   * a ref, or a function asked at that moment. Without one (or when it is
   * gone too) focus lands on the opener's neighbour, else the page title.
   */
  fallbackFocus?: FocusFallback;
  className?: string;
  children: ReactNode;
};

export function Overlay(props: OverlayProps) {
  if (!props.open) return null;
  return <OverlayLayer {...props} />;
}

function OverlayLayer({
  onClose, onBackdrop, align = 'center', labelledBy, describedBy, label, initialFocus, returnFocus, fallbackFocus, className, children,
}: OverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const layerId = useId();
  // Captured during the first render — before any child's autoFocus runs —
  // so focus goes back to what opened the layer, not to its first field.
  const [returnTo] = useState<Element | null>(
    () => returnFocus ?? (typeof document === 'undefined' ? null : document.activeElement),
  );
  const downOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;

  useLayoutEffect(() => {
    const root = rootRef.current!;
    layerStack.push(layerId);
    layerRoots.set(layerId, root);
    if (align === 'right') drawerLayers.add(layerId);
    syncCaptionDim();
    lockPageScroll();
    const neighbours = neighboursOf(returnTo, root);

    if (!root.contains(document.activeElement)) {
      const target = safeFocusTarget(root, initialFocus?.current);
      target.focus({ preventScroll: true });
      if (target !== root) revealInLayer(target, root);
    }

    // Focus that leaves the top layer by any route (a click on something
    // behind it, a script) is brought back in.
    const onFocusIn = (e: FocusEvent) => {
      if (layerStack[layerStack.length - 1] !== layerId) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        (focusablesIn(root)[0] ?? root).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      const i = layerStack.lastIndexOf(layerId);
      if (i >= 0) layerStack.splice(i, 1);
      layerRoots.delete(layerId);
      drawerLayers.delete(layerId);
      syncCaptionDim();
      unlockPageScroll();
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus({ preventScroll: true });
      // Checked again once the commit is through: the opener can still be
      // connected here and leave in the same commit that closes the layer.
      const fallback = fallbackRef.current;
      setTimeout(() => recoverFocus(fallback, neighbours), 0);
    };
    // Mount/unmount only: the layer's identity is its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (layerStack[layerStack.length - 1] !== layerId) return;
    if (e.key === 'Escape') {
      if (!onCloseRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = rootRef.current!;
    const items = focusablesIn(root);
    if (!items.length) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const placement = {
    // On a phone a centred dialog becomes a bottom sheet. Inside the desktop
    // shell the top padding grows by up to 36px, so a tall dialog never
    // slides its close button under the OS caption buttons — at every width,
    // since zooming the shell's 900px minimum past ~141% puts it in the
    // bottom-sheet range with the buttons still there (the min() is 0
    // outside the shell, where --caption-inset is 0).
    center: 'items-end justify-center pt-[calc(1.5rem+min(var(--caption-inset),2.25rem))] sm:items-center sm:px-6 sm:pb-6',
    bottom: 'items-end justify-center pt-[calc(1.5rem+min(var(--caption-inset),2.25rem))] sm:px-6',
    right: 'justify-end',
  }[align];

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // Only a press that also started on the backdrop: dragging a text
        // selection out of a field must not close the form under it.
        if (e.target !== e.currentTarget || !downOnBackdrop.current) return;
        (onBackdrop ?? onClose)?.();
      }}
      // A light surface: the page's focus ring, also when opened from inside
      // the navy masthead (see :focus-visible in globals.css).
      className={cx('anim-fade fixed inset-0 z-100 flex bg-scrim outline-none [--focus-ring:var(--focus)]', placement, className)}
      style={NO_DRAG}
    >
      {children}
    </div>
  );
}

const SHEET_WIDTHS = { sm: 'sm:max-w-[440px]', md: 'sm:max-w-[540px]', lg: 'sm:max-w-[680px]' } as const;

/**
 * Whether a scroller has content hidden below its visible part — the cue for
 * the hairline a fixed footer draws over it (and above, for a fixed header).
 * Also publishes the scroller's own scrollbar width as `--sbw` on it, so its
 * content can hand that room back (see Panel). Re-measured on scroll, and
 * whenever the scroller or its content changes size.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    el.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
    setEdges((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // The content grows and shrinks (an error appears, a step changes)
    // without the scroller itself changing size.
    const inner = el.firstElementChild;
    if (inner) ro?.observe(inner);
    return () => ro?.disconnect();
  }, [measure]);

  return { ref, edges, measure };
}

/** The hairline a pinned footer draws once content scrolls under it (Sheet, Popover). */
const FOOTER_EDGE = 'shadow-[0_-1px_0_var(--line)]';

/**
 * The panel of a centred dialog: 16px corners, a bottom sheet on phones.
 * `band` adds the navy header band with a centred pictogram — the dialog
 * form the reference uses for anything that needs your attention.
 *
 * `footer` (the dialog's buttons) stays put under the scrolling body, so in a
 * short window the way out is never scrolled out of reach; a hairline marks
 * it once there is more above it to scroll to. In a short window the band
 * also slims down, giving its room to what the dialog says.
 */
export function Sheet({
  size, wide, band, onClose, closeLabel = 'Schließen', className, bodyClassName, footer, children,
}: {
  size?: 'sm' | 'md' | 'lg';
  /** @deprecated use size="md". */
  wide?: boolean;
  band?: { icon: ReactNode; tone?: 'navy' | 'plain' };
  /** Renders a close button in the top-right corner. */
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
  bodyClassName?: string;
  /** The actions row, fixed below the scrolling body (see DialogActions). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const navy = band && band.tone !== 'plain';
  const { ref: bodyRef, edges, measure } = useScrollEdges<HTMLDivElement>();
  return (
    <div
      className={cx(
        'anim-sheet relative flex max-h-full w-full flex-col overflow-hidden bg-raised shadow-[var(--shadow-pop)]',
        'rounded-t-[var(--radius-sheet)] sm:rounded-[var(--radius-sheet)]',
        SHEET_WIDTHS[size ?? (wide ? 'md' : 'sm')],
        className,
      )}
    >
      {band && (
        <div
          aria-hidden
          className={cx(
            'grid h-[88px] shrink-0 place-items-center short:h-14',
            navy ? 'bg-stage text-stage-ink dark:bg-bar' : 'bg-accent-soft text-accent',
          )}
        >
          <span
            className={cx(
              'grid size-12 place-items-center rounded-full short:scale-[0.8]',
              navy ? 'bg-[color-mix(in_srgb,var(--stage-ink)_14%,transparent)]' : 'bg-surface',
            )}
          >
            {band.icon}
          </span>
        </div>
      )}
      {onClose && (
        <IconButton
          data-dialog-close
          tone={navy ? 'stage' : 'page'}
          aria-label={closeLabel}
          onClick={onClose}
          className="absolute top-3 right-3 z-1"
        >
          <CloseIcon />
        </IconButton>
      )}
      <div
        ref={bodyRef}
        onScroll={measure}
        className={cx(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-6 sm:px-7 sm:pt-7 short:pt-5',
          // With a footer the body keeps only room for a focus ring at its
          // edge; the footer's own top padding is the gap to the buttons.
          footer ? 'pb-1' : 'pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-7',
          bodyClassName,
        )}
      >
        {/* One element, so the scroll edge hears the content change size. */}
        <div>{children}</div>
      </div>
      {footer && (
        <div
          className={cx(
            'relative shrink-0 px-5 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-shadow duration-150 sm:px-7 sm:pb-7',
            'short:pt-3 short:pb-[max(1rem,env(safe-area-inset-bottom))] sm:short:pb-5',
            edges.bottom && FOOTER_EDGE,
          )}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

/** Title row of a dialog: an optional pictogram, the title, a line of context, a close button. */
export function DialogHeader({
  title, titleId, description, onClose, closeLabel = 'Schließen', icon, className,
}: {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start gap-3.5', className ?? 'mb-5')}>
      {icon && <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 id={titleId} className="text-[22px] leading-tight font-bold text-headline">{title}</h2>
        {description && <div className="mt-1.5 text-[15px] leading-snug text-ink-2">{description}</div>}
      </div>
      {onClose && (
        <IconButton data-dialog-close aria-label={closeLabel} onClick={onClose} size="md" className="-mt-1.5 -mr-2">
          <CloseIcon />
        </IconButton>
      )}
    </div>
  );
}

/**
 * The button row at the foot of a dialog. Primary goes LAST in the markup:
 * rightmost on desktop, topmost (closest to the thumb's reach and the eye)
 * when the row stacks on a phone. Hand it to Sheet as its `footer` (Dialog
 * does), with `className=""`, so it stays in view however far the dialog's
 * text has to scroll in a short window.
 */
export function DialogActions({
  children, align = 'end', className,
}: { children: ReactNode; align?: 'end' | 'center' | 'stretch' | 'between'; className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-col-reverse gap-3 sm:flex-row sm:items-center',
        align === 'end' && 'sm:justify-end',
        align === 'center' && 'sm:justify-center',
        align === 'between' && 'sm:justify-between',
        align === 'stretch' && 'sm:[&>*]:flex-1',
        className ?? 'mt-6',
      )}
    >
      {children}
    </div>
  );
}

/** A complete small dialog — confirmations, notices. */
export function Dialog({
  open, onClose, onBackdrop, title, description, icon, band, size = 'sm', actions, children, initialFocus, fallbackFocus,
}: {
  open: boolean;
  onClose?: () => void;
  onBackdrop?: () => void;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  band?: { icon: ReactNode; tone?: 'navy' | 'plain' };
  size?: 'sm' | 'md' | 'lg';
  actions?: ReactNode;
  children?: ReactNode;
  initialFocus?: RefObject<HTMLElement | null>;
  fallbackFocus?: FocusFallback;
}) {
  const id = useId();
  const titleId = `dlg${id}-title`;
  const descId = description ? `dlg${id}-desc` : undefined;
  return (
    <Overlay open={open} onClose={onClose} onBackdrop={onBackdrop} labelledBy={titleId} describedBy={descId} initialFocus={initialFocus} fallbackFocus={fallbackFocus}>
      <Sheet
        size={size}
        band={band}
        onClose={band ? onClose : undefined}
        footer={actions ? <DialogActions align={band ? 'center' : 'end'} className="">{actions}</DialogActions> : undefined}
      >
        <DialogHeader
          title={title}
          titleId={titleId}
          icon={band ? undefined : icon}
          onClose={band ? undefined : onClose}
          description={description ? <span id={descId}>{description}</span> : undefined}
          // Nothing follows the header but the pinned buttons: no gap to keep.
          className={cx(band && 'text-center', children ? (band ? 'mb-4' : 'mb-5') : 'mb-0')}
        />
        {children}
      </Sheet>
    </Overlay>
  );
}

/**
 * A panel from the right edge — details, Mitteilungen. Its header is a navy
 * band exactly as tall as the masthead, so in the desktop shell the OS
 * caption buttons (which stay on top of everything) sit on the same navy and
 * the header's own controls are padded clear of them.
 */
export function Drawer({
  open, onClose, title, titleId, actions, footer, width = 'md', children, bodyClassName, fallbackFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  titleId?: string;
  /** Extra controls in the header row, left of the close button. */
  actions?: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
  bodyClassName?: string;
  /** Where focus goes on close when the control that opened the drawer is gone. */
  fallbackFocus?: FocusFallback;
  children: ReactNode;
}) {
  const auto = useId();
  const id = titleId ?? `drawer${auto}-title`;
  return (
    <Overlay open={open} onClose={onClose} align="right" labelledBy={id} fallbackFocus={fallbackFocus}>
      <div
        className={cx(
          'anim-drawer flex h-dvh w-full flex-col bg-raised shadow-[var(--shadow-pop)]',
          width === 'lg' ? 'sm:max-w-[560px]' : 'sm:max-w-[440px]',
        )}
      >
        <header className="on-bar bar-caption-safe flex shrink-0 items-center gap-2 bg-bar pl-4 text-bar-ink sm:pl-6" style={{ height: 'var(--barbar-h)' }}>
          <h2 id={id} className="min-w-0 flex-1 truncate text-[17px] font-bold">{title}</h2>
          {actions}
          <IconButton data-dialog-close tone="bar" size="md" aria-label="Schließen" onClick={onClose} className="-mr-2">
            <CloseIcon />
          </IconButton>
        </header>
        <div className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', bodyClassName ?? 'px-4 py-5 sm:px-6')}>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</div>
        )}
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------------------
// Disclosure — the one collapsible-group header in the app.
//
// Every grouped list (accounts, vorgemerkte Umsätze, a day of bookings, the
// Referenzen of a booking) opens and closes through this, so the chevron, the
// hit area, the sticky offset and the aria wiring are decided once.
// ---------------------------------------------------------------------------
export function Disclosure({
  open: openProp, onToggle, defaultOpen = false, title, trailing, sticky, tone = 'plain', className, headerClassName, children,
}: {
  /** Controlled when given (with onToggle); otherwise the Disclosure keeps its own state. */
  open?: boolean;
  onToggle?: () => void;
  defaultOpen?: boolean;
  title: ReactNode;
  /** Sits at the right edge of the header — a count, a total, a refresh. */
  trailing?: ReactNode;
  /** Pin the header to the top of the scrolling page while its group is scrolled through. */
  sticky?: boolean;
  tone?: 'plain' | 'inset' | 'amber';
  className?: string;
  headerClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const toggle = onToggle ?? (() => setOwn((o) => !o));
  const tones = {
    plain: 'text-ink-2 hover:text-ink',
    inset: 'bg-inset text-ink-2 hover:text-ink',
    amber: 'bg-amber-soft text-amber',
  } as const;

  return (
    <div className={className}>
      <div className={cx('flex min-h-11 items-center gap-2 px-4', tones[tone], sticky && 'sticky top-0 z-5', headerClassName)}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={id}
          className="-ml-1 flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md pl-1 text-left"
        >
          <ChevronIcon className="chev shrink-0 opacity-70" data-open={open} />
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {trailing}
      </div>
      <div id={id} hidden={!open}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs and Segmented
//
// Both are roving-tabindex groups: one tab stop for the whole row, arrows
// move and select, Home/End jump. Tabs switch a region (role=tablist, with
// TabPanel); Segmented picks a value (role=radiogroup).
// ---------------------------------------------------------------------------
function rovingKey(e: ReactKeyboardEvent, count: number, current: number, vertical = false): number | null {
  const next = vertical ? 'ArrowDown' : 'ArrowRight';
  const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
  if (e.key === next) return (current + 1) % count;
  if (e.key === prev) return (current - 1 + count) % count;
  if (e.key === 'Home') return 0;
  if (e.key === 'End') return count - 1;
  return null;
}

export type TabItem<T extends string> = { id: T; label: ReactNode; icon?: ReactNode; count?: number };

export const tabDomId = (base: string, id: string) => `${base}-tab-${id}`;
export const tabPanelDomId = (base: string, id: string) => `${base}-panel-${id}`;

export function Tabs<T extends string>({
  items, value, onChange, variant = 'underline', idBase, className, 'aria-label': ariaLabel,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** underline: the institute bar (3px accent rule under the active tab) · pill: inside a tile. */
  variant?: 'underline' | 'pill';
  /** Prefix for tab/panel ids — pass the same to TabPanel. */
  idBase: string;
  className?: string;
  'aria-label': string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, items.findIndex((t) => t.id === value));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const n = rovingKey(e, items.length, current);
    if (n == null) return;
    e.preventDefault();
    onChange(items[n].id);
    refs.current[n]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cx(
        // A row that does not fit scrolls sideways rather than wrapping or
        // pushing the page wider; the scrollbar is hidden, the row still swipes.
        variant === 'underline'
          ? 'flex min-w-0 items-stretch gap-1 self-stretch overflow-x-auto [scrollbar-width:none]'
          : 'inline-flex flex-wrap gap-1.5',
        className,
      )}
    >
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={tabDomId(idBase, t.id)}
            aria-selected={selected}
            aria-controls={tabPanelDomId(idBase, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              'relative inline-flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap transition-colors duration-150',
              variant === 'underline'
                ? cx(
                    // The row scrolls (and so clips), so the ring is drawn inside the tab.
                    'rounded-md px-3 text-[15px] focus-visible:-outline-offset-2',
                    selected ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  )
                : cx(
                    'h-9 rounded-full px-4 text-[14px]',
                    selected ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-inset hover:text-ink',
                  ),
            )}
          >
            {t.icon}
            {t.label}
            {t.count != null && (
              <CountBadge count={t.count} tone={variant === 'pill' && selected ? 'onAccent' : 'neutral'} />
            )}
            {variant === 'underline' && (
              <span
                aria-hidden
                className={cx(
                  'absolute inset-x-2 bottom-0 h-[3px] rounded-t-full transition-colors duration-150',
                  selected ? 'bg-accent' : 'bg-transparent',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idBase, id, active, className, children,
}: { idBase: string; id: string; active: boolean; className?: string; children: ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={tabPanelDomId(idBase, id)} aria-labelledby={tabDomId(idBase, id)} className={className}>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, size = 'md', block, className, 'aria-label': ariaLabel,
}: {
  options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  block?: boolean;
  className?: string;
  'aria-label': string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const n = rovingKey(e, options.length, current);
    if (n == null) return;
    e.preventDefault();
    if (options[n].disabled) return;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cx(
        'max-w-full gap-1 overflow-x-auto rounded-full bg-inset p-1 [scrollbar-width:none]',
        block ? 'flex' : 'inline-flex',
        className,
      )}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150',
              size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-[14px]',
              block && 'flex-1',
              // The thumb alone is barely lighter than the track (1.14:1 in
              // light), so the chosen value is told by an action-blue edge
              // (over 4:1 against track and thumb in both themes) and, in
              // light, a blue label. In the dark a surface-coloured thumb would
              // sink into the track, so it is lifted with a touch of ink
              // instead — and keeps ink text, as blue on that lift would fall
              // under 4.5:1.
              checked
                ? 'bg-surface text-accent shadow-[inset_0_0_0_1.5px_var(--accent),var(--shadow-card)] dark:bg-[color-mix(in_srgb,var(--ink)_14%,var(--inset))] dark:text-ink'
                : 'text-ink-2 hover:text-ink',
              'disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips, tags, badges
// ---------------------------------------------------------------------------
const CHIP_BASE =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] border px-3 text-[14px] font-semibold whitespace-nowrap ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45';

/**
 * A filter toggle: outlined in action blue; selected adds a 10 % tint and a
 * check (the check, not the tint, is what says "on" without colour).
 * `menu` makes it the trigger of a dropdown instead (a chevron, no check).
 */
export function FilterChip({
  selected = false, count, icon, menu, className, children, ...rest
}: ComponentProps<'button'> & { selected?: boolean; count?: number; icon?: ReactNode; menu?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={menu ? undefined : selected}
      className={cx(
        CHIP_BASE,
        'border-accent text-accent',
        selected ? 'bg-accent-soft' : 'hover:bg-accent-soft',
        className,
      )}
      {...rest}
    >
      {selected && !menu && <CheckIcon size={16} strokeWidth={2.2} />}
      {icon}
      <span>{children}</span>
      {count != null && count > 0 && <CountBadge count={count} tone="accent" />}
      {menu && <ChevronIcon size={14} strokeWidth={2} className="-mr-0.5" />}
    </button>
  );
}

/**
 * A chip that is a value rather than a filter — a recent payee to pick, a
 * source note ("Aus GiroCode übernommen"). Pressable when it has onClick,
 * removable when it has onRemove, otherwise a quiet label.
 */
export function Chip({
  children, icon, onClick, onRemove, removeLabel, selected, className, title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  onRemove?: () => void;
  /** Accessible name of the remove button; defaults to "Entfernen". */
  removeLabel?: string;
  selected?: boolean;
  className?: string;
  title?: string;
}) {
  const look = onClick
    ? cx('border-accent text-accent', selected ? 'bg-accent-soft' : 'hover:bg-accent-soft')
    : 'border-line-strong text-ink-2';
  // A picked chip carries FilterChip's check, not only the tint: the tint is
  // a shade away from the surface, the check is a shape.
  const body = (
    <>
      {onClick && selected && <CheckIcon size={16} strokeWidth={2.2} className="shrink-0" />}
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
  return (
    <span className={cx('inline-flex max-w-full items-center', className)}>
      {onClick ? (
        <button type="button" title={title} aria-pressed={selected} onClick={onClick} className={cx(CHIP_BASE, 'max-w-full', look, onRemove && 'rounded-r-none border-r-0 pr-2')}>
          {body}
        </button>
      ) : (
        <span title={title} className={cx(CHIP_BASE, 'max-w-full', look, onRemove && 'rounded-r-none border-r-0 pr-1')}>{body}</span>
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={removeLabel ?? 'Entfernen'}
          title={removeLabel ?? 'Entfernen'}
          onClick={onRemove}
          className={cx(
            'grid h-9 w-8 shrink-0 place-items-center rounded-r-[var(--radius-chip)] border border-l-0 transition-colors duration-150',
            onClick ? 'border-accent text-accent hover:bg-accent-soft' : 'border-line-strong text-ink-3 hover:bg-inset hover:text-ink',
          )}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </span>
  );
}

export type TagTone = 'neutral' | 'info' | 'positive' | 'negative' | 'pending' | 'emphasis';

const TAG_TONES: Record<TagTone, string> = {
  neutral: 'bg-inset text-ink-2',
  info: 'bg-info-soft text-info',
  positive: 'bg-green-soft text-green',
  negative: 'bg-red-soft text-red',
  pending: 'bg-amber-soft text-amber',
  // Orange may only be a mark: the text stays ink, a dot carries the colour.
  emphasis: 'bg-[color-mix(in_srgb,var(--emphasis)_11%,var(--surface))] text-ink',
};

/** A status word on a row or a heading — "Vorgemerkt", "Echtzeit", "Gerät gemerkt". Not interactive. */
export function Tag({
  tone = 'neutral', icon, size = 'md', className, title, children,
}: { tone?: TagTone; icon?: ReactNode; size?: 'sm' | 'md'; className?: string; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-[6px] leading-none font-semibold whitespace-nowrap',
        size === 'sm' ? 'h-5 px-1.5 text-[12.5px]' : 'h-6 px-2 text-[12.5px]',
        TAG_TONES[tone],
        className,
      )}
    >
      {tone === 'emphasis' && !icon && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-emphasis" />}
      {icon}
      {children}
    </span>
  );
}

/** Same thing, the other name people reach for. */
export const Badge = Tag;

/** A small count bubble — filters applied, unread messages. */
export function CountBadge({
  count, tone = 'neutral', max = 99, className,
}: { count: number; tone?: 'neutral' | 'accent' | 'onAccent' | 'bar'; max?: number; className?: string }) {
  return (
    <span
      className={cx(
        'tnum inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[12px] leading-none font-bold',
        tone === 'accent' && 'bg-accent text-accent-ink',
        tone === 'onAccent' && 'bg-accent-ink text-accent',
        tone === 'neutral' && 'bg-inset text-ink-2',
        tone === 'bar' && 'bg-[color-mix(in_srgb,var(--bar-ink)_18%,transparent)] text-bar-ink',
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}

/** The orange unread mark. Decorative: pair it with text that says the same. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full bg-emphasis', className)} />;
}

// ---------------------------------------------------------------------------
// Floating layers: Menu and Popover.
//
// Positioned `fixed` against the trigger's rect and kept inside the viewport:
// below by default, flipped above when there is more room there, clamped 8px
// from either side, and re-measured on scroll (of any container) and resize.
// In the desktop shell a layer that reaches the window's top-right corner
// also stops below the OS caption buttons, which sit on top of everything and
// take every click there (the arithmetic is lib/anchor's).
// ---------------------------------------------------------------------------
export type { Placement };

/**
 * The OS caption buttons' block in the desktop shell (Window Controls
 * Overlay); 0 × 0 everywhere else. Read back from a probe sized by the same
 * env() values --caption-inset is built from — the custom property itself
 * would come back as unresolved calc() text. Measured afresh on every
 * placement, so maximise, restore and zoom are always current.
 */
function captionBlock(): { width: number; height: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;right:0;visibility:hidden;pointer-events:none;' +
    'width:var(--caption-inset,0px);height:env(titlebar-area-height,0px)';
  document.body.appendChild(probe);
  const { width, height } = probe.getBoundingClientRect();
  probe.remove();
  return { width, height };
}

function useAnchoredPosition(
  anchor: RefObject<HTMLElement | null>,
  floating: RefObject<HTMLElement | null>,
  open: boolean,
  placement: Placement,
  gap = 6,
): CSSProperties {
  const [pos, setPos] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const a = anchor.current;
      const f = floating.current;
      if (!a || !f) return;
      const { top, left, maxHeight } = anchorPosition({
        anchor: a.getBoundingClientRect(),
        width: f.offsetWidth,
        height: f.scrollHeight,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: window.innerHeight,
        placement,
        gap,
        caption: captionBlock(),
      });
      setPos((p) =>
        p.top === top && p.left === left && p.maxHeight === maxHeight && p.visibility === 'visible'
          ? p
          : { position: 'fixed', top, left, maxHeight, visibility: 'visible' },
      );
    };
    place();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (floating.current) ro?.observe(floating.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro?.disconnect();
    };
  }, [open, placement, anchor, floating, gap]);

  return open ? pos : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
}

/** Closes on a pointer press outside both the trigger and the layer. */
function useOutsidePress(open: boolean, refs: Array<RefObject<HTMLElement | null>>, onOutside: () => void) {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && refs.some((r) => r.current?.contains(t))) return;
      cb.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // refs are stable ref objects
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export type TriggerProps = {
  ref: RefCallback<HTMLElement>;
  id: string;
  'aria-haspopup': 'menu' | 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
};

type MenuCtx = { close: (returnFocus?: boolean) => void };
const MenuContext = createContext<MenuCtx | null>(null);

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemradio"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])';

/**
 * A button-triggered menu (role=menu). The trigger is a render prop so any
 * control can open it — a pill, a chip, a masthead item:
 *
 *   <Menu label="Export" trigger={(p) => <Button {...p}>Export</Button>}>
 *     <MenuItem onSelect={…}>Kontoauszug als PDF</MenuItem>
 *   </Menu>
 *
 * Keyboard: Enter/Space/↓ open on the first item, ↑ on the last; arrows,
 * Home/End and typeahead move; Enter selects; Escape closes and returns focus
 * to the trigger; Tab closes and moves on.
 */
export function Menu({
  trigger, children, label, placement = 'bottom-start', className, minWidth = 220, onOpenChange,
}: {
  trigger: (props: TriggerProps, state: { open: boolean }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** The menu's accessible name; defaults to the trigger's. */
  label?: string;
  placement?: Placement;
  className?: string;
  minWidth?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const auto = useId();
  const triggerId = `menu${auto}-trigger`;
  const menuId = `menu${auto}`;
  const [open, setOpenState] = useState(false);
  const focusOnOpen = useRef<'first' | 'last' | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const style = useAnchoredPosition(triggerRef, menuRef, open, placement);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  }, [onOpenChange]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, [setOpen]);

  useOutsidePress(open, [triggerRef, menuRef], () => close(false));

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  // Focus the first/last item (or the checked radio) once the menu is placed.
  // Not on the first commit: the layer is still visibility:hidden while it
  // is being measured, and a hidden element cannot take focus.
  const placed = open && style.visibility === 'visible';
  useLayoutEffect(() => {
    if (!placed || !focusOnOpen.current) return;
    const list = items();
    const checked = list.find((el) => el.getAttribute('aria-checked') === 'true');
    const target = focusOnOpen.current === 'last' ? list[list.length - 1] : (checked ?? list[0]);
    (target ?? menuRef.current)?.focus({ preventScroll: true });
    focusOnOpen.current = null;
  }, [placed]);

  const triggerProps: TriggerProps = {
    ref: (el) => { triggerRef.current = el; },
    id: triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => {
      focusOnOpen.current = 'first';
      if (open) close(false);
      else setOpen(true);
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusOnOpen.current = e.key === 'ArrowUp' ? 'last' : 'first';
        setOpen(true);
      }
    },
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      // Focus goes back to the trigger first, so the browser's own Tab move
      // continues from there instead of from an item that is about to vanish.
      close(true);
      return;
    }
    if (list.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      // From the menu itself (nothing focused yet) ↓/Home start at the top, ↑/End at the bottom.
      const n = i < 0
        ? (e.key === 'ArrowDown' || e.key === 'Home' ? 0 : list.length - 1)
        : rovingKey(e, list.length, i, true)!;
      list[n]?.focus();
      return;
    }
    // Typeahead: jump to the next item starting with what was typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
      const now = Date.now();
      const t = typeahead.current;
      t.text = now - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
      t.at = now;
      const start = t.text.length === 1 ? i + 1 : Math.max(i, 0);
      for (let k = 0; k < list.length; k++) {
        const el = list[(start + k) % list.length];
        if ((el.textContent ?? '').trim().toLowerCase().startsWith(t.text)) {
          el.focus();
          break;
        }
      }
    }
  };

  return (
    <MenuContext.Provider value={{ close }}>
      {trigger(triggerProps, { open })}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={label ? undefined : triggerId}
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          style={{ ...style, minWidth, ...NO_DRAG }}
          className={cx(
            'anim-pop z-120 max-w-[min(360px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-[12px] bg-raised p-1.5 text-ink shadow-[var(--shadow-pop)] outline-none [--focus-ring:var(--focus)]',
            className,
          )}
        >
          {typeof children === 'function' ? children(() => close(true)) : children}
        </div>
      )}
    </MenuContext.Provider>
  );
}

const MENU_ITEM =
  'flex min-h-10 w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-[15px] leading-snug text-ink outline-none ' +
  'focus:bg-inset focus-visible:shadow-[inset_0_0_0_2px_var(--focus)] aria-disabled:cursor-not-allowed aria-disabled:opacity-45';

type MenuItemBase = {
  children: ReactNode;
  icon?: ReactNode;
  /** Right-aligned extra — a shortcut (Kbd), a value. */
  hint?: ReactNode;
  /** A second line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  /** Keep the menu open after selecting (a toggle among several). */
  keepOpen?: boolean;
  onSelect?: () => void;
  className?: string;
};

function useMenuItem({ disabled, keepOpen, onSelect }: Pick<MenuItemBase, 'disabled' | 'keepOpen' | 'onSelect'>) {
  const menu = useContext(MenuContext);
  return {
    tabIndex: -1,
    'aria-disabled': disabled || undefined,
    // Moving the pointer moves focus too, so keyboard and mouse share one
    // highlight and arrows continue from where the pointer left off.
    onMouseMove: (e: ReactMouseEvent<HTMLElement>) => {
      if (!disabled && document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
    },
    onClick: () => {
      if (disabled) return;
      onSelect?.();
      if (!keepOpen) menu?.close(true);
    },
  };
}

function ItemBody({ icon, children, description, hint, lead }: Pick<MenuItemBase, 'icon' | 'children' | 'description' | 'hint'> & { lead?: ReactNode }) {
  return (
    <>
      {lead}
      {icon && <span className="shrink-0 text-ink-2">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block">{children}</span>
        {description && <span className="mt-0.5 block text-[13px] text-ink-3">{description}</span>}
      </span>
      {hint && <span className="shrink-0 text-[13px] text-ink-3">{hint}</span>}
    </>
  );
}

export function MenuItem({ tone = 'default', className, ...p }: MenuItemBase & { tone?: 'default' | 'danger' }) {
  const handlers = useMenuItem(p);
  return (
    <button type="button" role="menuitem" {...handlers} className={cx(MENU_ITEM, tone === 'danger' && 'text-red', className)}>
      <ItemBody {...p} />
    </button>
  );
}

/** One of a set of choices; put the set in a MenuGroup. */
export function MenuItemRadio({ checked, className, ...p }: MenuItemBase & { checked: boolean }) {
  const handlers = useMenuItem(p);
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} {...handlers} className={cx(MENU_ITEM, className)}>
      <ItemBody
        {...p}
        hint={p.hint ?? (checked ? <CheckIcon size={18} strokeWidth={2.2} className="text-accent" /> : <span className="inline-block w-[18px]" />)}
      />
    </button>
  );
}

export function MenuItemCheckbox({ checked, className, ...p }: MenuItemBase & { checked: boolean }) {
  const handlers = useMenuItem({ ...p, keepOpen: p.keepOpen ?? true });
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} {...handlers} className={cx(MENU_ITEM, className)}>
      <ItemBody
        {...p}
        lead={
          <span
            aria-hidden
            className={cx(
              'grid size-[18px] shrink-0 place-items-center rounded-[4px] border-[1.5px]',
              checked ? 'border-accent bg-accent text-accent-ink' : 'border-field-line',
            )}
          >
            {checked && <CheckIcon size={12} strokeWidth={3} />}
          </span>
        }
      />
    </button>
  );
}

export function MenuGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={label ? id : undefined}>
      {label && <MenuLabel id={id}>{label}</MenuLabel>}
      {children}
    </div>
  );
}

export function MenuLabel({ id, children }: { id?: string; children: ReactNode }) {
  return <div id={id} role="presentation" className="px-3 pt-2 pb-1 text-[12.5px] font-semibold text-ink-3">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1.5 h-px bg-line" />;
}

/**
 * A non-modal floating panel with its own content — a custom date range, a
 * small form. Focus moves in on open; Escape closes and returns it; a press
 * outside or tabbing out closes it.
 *
 * `footer` stays put under the scrolling content, as a Sheet's does: the
 * panel's way out (the Sitzung panel's "Abmelden") is never scrolled out of
 * reach in a short window, with the same hairline once content runs under it.
 */
export function Popover({
  trigger, children, footer, label, labelledBy, placement = 'bottom-start', className, open: openProp, onOpenChange,
}: {
  trigger: (props: TriggerProps, state: { open: boolean }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Fixed below the scrolling content (see Sheet's `footer`). */
  footer?: ReactNode | ((close: () => void) => ReactNode);
  label?: string;
  labelledBy?: string;
  placement?: Placement;
  className?: string;
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const auto = useId();
  const triggerId = `pop${auto}-trigger`;
  const panelId = `pop${auto}`;
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const style = useAnchoredPosition(triggerRef, panelRef, open, placement);

  const setOpen = useCallback((v: boolean) => {
    if (openProp === undefined) setOwn(v);
    onOpenChange?.(v);
  }, [openProp, onOpenChange]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, [setOpen]);

  useOutsidePress(open, [triggerRef, panelRef], () => close(false));

  // Focus moves in once the panel is placed (see Menu: hidden can't take
  // focus) — to the safe place, as in a dialog (safeFocusTarget): a panel of
  // settings opens on itself, announced by its name, never on its first
  // radio or switch, where an arrow key or Space would change something.
  const placed = open && style.visibility === 'visible';
  useLayoutEffect(() => {
    if (!placed) return;
    const root = panelRef.current;
    if (!root) return;
    const target = safeFocusTarget(root);
    target.focus({ preventScroll: true });
    if (target !== root) revealInLayer(target, root);
  }, [placed]);

  const triggerProps: TriggerProps = {
    ref: (el) => { triggerRef.current = el; },
    id: triggerId,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? panelId : undefined,
    onClick: () => setOpen(!open),
    onKeyDown: () => {},
  };

  return (
    <>
      {trigger(triggerProps, { open })}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-label={labelledBy ? undefined : label}
          aria-labelledby={labelledBy}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && !panelRef.current?.contains(next) && !triggerRef.current?.contains(next)) close(false);
          }}
          style={{ ...style, ...NO_DRAG }}
          className={cx(
            // Opened from the masthead, but a light surface: the page's focus ring.
            'anim-pop z-120 max-w-[calc(100vw-16px)] rounded-[12px] bg-raised text-ink shadow-[var(--shadow-pop)] outline-none [--focus-ring:var(--focus)]',
            // With a footer the panel itself does not scroll: its body does.
            footer ? 'flex flex-col overflow-hidden' : 'overflow-y-auto overscroll-contain p-4',
            className,
          )}
        >
          {footer ? (
            <PopoverBody fit={style.maxHeight} footer={typeof footer === 'function' ? footer(() => close(true)) : footer}>
              {typeof children === 'function' ? children(() => close(true)) : children}
            </PopoverBody>
          ) : typeof children === 'function' ? children(() => close(true)) : children}
        </div>
      )}
    </>
  );
}

/**
 * A Popover's scrolling content and pinned footer. Mounted with the panel;
 * the edge is measured again once the panel is placed and given its height
 * (`fit`), before that frame is painted.
 */
function PopoverBody({ fit, footer, children }: { fit: CSSProperties['maxHeight']; footer: ReactNode; children: ReactNode }) {
  const { ref, edges, measure } = useScrollEdges<HTMLDivElement>();
  useLayoutEffect(measure, [fit, measure]);
  return (
    <>
      <div ref={ref} onScroll={measure} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {/* One element, so the scroll edge hears the content change size. */}
        <div>{children}</div>
      </div>
      <div className={cx('shrink-0 bg-raised px-4 py-3 transition-shadow duration-150', edges.bottom && FOOTER_EDGE)}>
        {footer}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** A content block on the page: `.panel` with an optional header row. */
export function Tile({
  as: As = 'section', title, titleId, subtitle, actions, className, children, 'aria-label': ariaLabel,
}: {
  as?: 'section' | 'div' | 'aside' | 'article';
  title?: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  const auto = useId();
  const id = title ? (titleId ?? `tile${auto}`) : undefined;
  return (
    <As className={cx('panel', className)} aria-labelledby={id} aria-label={id ? undefined : ariaLabel}>
      {title && <TileHeader title={title} titleId={id} subtitle={subtitle} actions={actions} />}
      {children}
    </As>
  );
}

export function TileHeader({
  title, titleId, subtitle, actions, className,
}: { title: ReactNode; titleId?: string; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3', className ?? 'px-4 pt-4 pb-3 sm:px-5 sm:pt-5')}>
      <div className="min-w-0">
        <h2 id={titleId} className="section-head">{title}</h2>
        {subtitle && <div className="mt-0.5 text-[13px] text-ink-3">{subtitle}</div>}
      </div>
      {actions && <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading, empty and failure states
// ---------------------------------------------------------------------------
export function Skeleton({
  className, width, height, circle, style,
}: { className?: string; width?: number | string; height?: number | string; circle?: boolean; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      className={cx('skel block', circle && 'rounded-full', className)}
      style={{ width, height, ...style }}
    />
  );
}

/** One placeholder booking row, shaped like the real one. */
export function SkeletonRow({ width = 60 }: { width?: number }) {
  return (
    <div aria-hidden className="flex items-center gap-3.5 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5">
      <div className="skel size-10 shrink-0 rounded-full" />
      <div className="flex-1">
        <div className="skel h-3" style={{ width: `${width}%` }} />
        <div className="skel mt-2 h-3" style={{ width: `${Math.max(20, width - 18)}%` }} />
      </div>
      <div className="skel h-3.5 w-16" />
    </div>
  );
}

export type Illustration = 'transactions' | 'search' | 'inbox' | 'chart' | 'contracts' | 'error' | 'done';

/**
 * Small line illustrations for empty and failure states: one soft disc, a
 * few strokes in the accent, detail in the quiet ink. Deliberately plain —
 * a picture that explains, not one that decorates.
 */
function IllustrationArt({ name }: { name: Illustration }) {
  const a = 'var(--accent)';
  const q = 'var(--ink-3)';
  const common = { fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden focusable="false" className="shrink-0">
      <circle cx="60" cy="48" r="40" fill="var(--accent-soft)" />
      {name === 'transactions' && (
        <g {...common}>
          <rect x="34" y="22" width="52" height="56" rx="7" stroke={a} fill="var(--surface)" />
          <path d="M44 36h18M44 48h24M44 60h14" stroke={q} />
          <path d="M74 36h2M74 48h2M74 60h2" stroke={a} />
        </g>
      )}
      {name === 'search' && (
        <g {...common}>
          <rect x="30" y="24" width="44" height="50" rx="7" stroke={q} fill="var(--surface)" />
          <path d="M40 38h22M40 49h16M40 60h12" stroke={q} />
          <circle cx="72" cy="56" r="13" stroke={a} fill="var(--surface)" />
          <path d="M81.5 65.5L91 75" stroke={a} />
        </g>
      )}
      {name === 'inbox' && (
        <g {...common}>
          <path d="M30 54l8-24a4 4 0 0 1 3.8-2.7h36.4A4 4 0 0 1 82 30l8 24" stroke={q} />
          <path d="M30 54v14a4 4 0 0 0 4 4h52a4 4 0 0 0 4-4V54H74l-4 7H50l-4-7H30z" stroke={a} fill="var(--surface)" />
        </g>
      )}
      {name === 'chart' && (
        <g {...common}>
          <path d="M30 74h60" stroke={q} />
          <rect x="36" y="50" width="10" height="24" rx="2" stroke={a} fill="var(--surface)" />
          <rect x="55" y="34" width="10" height="40" rx="2" stroke={a} fill="var(--surface)" />
          <rect x="74" y="58" width="10" height="16" rx="2" stroke={q} fill="var(--surface)" />
        </g>
      )}
      {name === 'contracts' && (
        <g {...common}>
          <rect x="32" y="26" width="48" height="46" rx="6" stroke={q} fill="var(--surface)" />
          <path d="M32 38h48M44 21v9M68 21v9" stroke={q} />
          <circle cx="78" cy="64" r="13" stroke={a} fill="var(--surface)" />
          <path d="M72.5 64a5.5 5.5 0 0 1 9.5-3.8M83.5 64a5.5 5.5 0 0 1-9.5 3.8M82 56.8v3.6h-3.6M74 71.2v-3.6h3.6" stroke={a} strokeWidth={2} />
        </g>
      )}
      {name === 'error' && (
        <g {...common}>
          <rect x="34" y="22" width="52" height="56" rx="7" stroke={q} fill="var(--surface)" />
          <path d="M44 36h24M44 47h16" stroke={q} />
          <circle cx="60" cy="62" r="10" stroke={a} fill="var(--surface)" />
          <path d="M60 57v5.5M60 66.5v.01" stroke={a} />
        </g>
      )}
      {name === 'done' && (
        <g {...common}>
          <circle cx="60" cy="48" r="22" stroke={a} fill="var(--surface)" />
          <path d="M50 48.5l7 7 13-14" stroke={a} strokeWidth={3} />
        </g>
      )}
    </svg>
  );
}

export function EmptyState({
  illustration, icon, title, children, action, className, compact,
}: {
  /** A built-in line illustration; `icon` (a 24-grid icon) is the smaller alternative. */
  illustration?: Illustration;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Less vertical room, for a side tile. */
  compact?: boolean;
}) {
  return (
    <div className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-10', className)}>
      {illustration ? (
        <IllustrationArt name={illustration} />
      ) : icon ? (
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">{icon}</span>
      ) : null}
      {title && <p className={cx('text-[17px] leading-snug font-bold text-ink', illustration || icon ? 'mt-3' : undefined)}>{title}</p>}
      {children && <div className="mt-1.5 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Das hat nicht geklappt', children, onRetry, retryLabel = 'Erneut versuchen', busy, className, compact,
}: {
  title?: ReactNode;
  /** The reason, as the bank or the app put it. */
  children?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  busy?: boolean;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div role="alert" className={cx('flex flex-col items-center text-center', compact ? 'px-4 py-6' : 'px-6 py-10', className)}>
      <IllustrationArt name="error" />
      <p className="mt-3 text-[17px] leading-snug font-bold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">{children}</div>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-4" busy={busy} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small parts
// ---------------------------------------------------------------------------

/** A labelled figure: "Verfügbar · 2.196,22 €". The value is a node so it can be a <Money>. */
export function Stat({
  label, value, sub, size = 'md', align = 'start', labelClassName, className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  align?: 'start' | 'end';
  labelClassName?: string;
  className?: string;
}) {
  return (
    <div className={cx('min-w-0', align === 'end' && 'text-right', className)}>
      <div className={cx('text-[13px] leading-snug font-semibold', labelClassName ?? 'text-ink-2')}>{label}</div>
      <div
        className={cx(
          'mt-0.5 leading-tight font-bold text-ink',
          size === 'sm' ? 'text-[16px]' : size === 'lg' ? 'text-[28px]' : 'text-[20px]',
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[13px] leading-snug text-ink-3">{sub}</div>}
    </div>
  );
}

/**
 * Short facts in a row with " · " between them: "Basis: Girokonto · 4 Umsätze".
 *
 * Where the row wraps (a phone), a line never starts or ends on a dot — a
 * dot left hanging at a line's end reads like a fact that went missing.
 * Each fact carries its dot in front of it, and the row starts one dot-width
 * left of its box, clipped: on every line, the first fact's dot sits in that
 * clipped margin and is not drawn. The dots are decoration; a screen reader
 * hears the facts as separate items.
 */
export function DotList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <span className={cx('block overflow-hidden', className)}>
      <span className="-ml-[0.8em] flex flex-wrap">
        {items.filter((item) => item != null && item !== false && item !== '').map((item, i) => (
          <span
            key={i}
            className="min-w-0 before:inline-block before:w-[0.8em] before:text-center before:content-['·'_/_'']"
          >
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-grid h-[22px] min-w-[22px] place-items-center rounded-[5px] border border-b-2 border-line-strong bg-surface px-1.5',
        'font-sans text-[12.5px] leading-none font-semibold text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
