'use client';

// Button
//
// Every button is M3E's (@m3e/web button): round, squeezed to a rounded
// square while pressed, with Material's state layers and ripple. Girovo's
// variants are Material's: the filled button leads, the filled tonal button
// seconds it, a text button is the quiet third. `quiet` is a text button in
// the neutral ink, `danger` a filled one in Soll Red — both by giving that
// one button other colour roles, so M3E draws every state of them itself.

import { type ComponentProps, type CSSProperties, type ReactNode, type Ref, useEffect, useRef, useState } from 'react';
import { M3eButton } from '@m3e/react/button';
import { M3eIconButton } from '@m3e/react/icon-button';
import { M3eLoadingIndicator } from '@m3e/react/loading-indicator';
import { M3eCircularProgressIndicator } from '@m3e/react/progress-indicator';
import { copyText } from '@/lib/clipboard';
import { useT } from '@/lib/i18n/react';
import { CheckIcon, CopyIcon, XCircleIcon } from '../icons';
import { cx } from './shared';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'quiet' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm' | 'xs';

export type ButtonProps = Omit<ComponentProps<'button'>, 'ref' | 'onClick'> & {
  ref?: Ref<HTMLElement>;
  /** M3E's element dispatches it: a DOM MouseEvent, not React's. */
  onClick?: (e: MouseEvent) => void;
  variant?: ButtonVariant;
  /** lg 56 (M3's medium button) · md and sm 40 (small) · xs 32 (extra-small) px tall. */
  size?: ButtonSize;
  block?: boolean;
  /** Shows a spinner, disables the button and marks it aria-busy. The label stays. */
  busy?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

const M3E_BUTTON_VARIANTS = {
  primary: 'filled', secondary: 'tonal', tertiary: 'text', quiet: 'text', danger: 'filled',
} as const satisfies Record<ButtonVariant, string>;

const M3E_BUTTON_SIZES = {
  lg: 'medium', md: 'small', sm: 'small', xs: 'extra-small',
} as const satisfies Record<ButtonSize, string>;

export function Button({
  variant = 'secondary', size = 'md', block, busy, iconLeft, iconRight, className, children, disabled, type = 'button', ...rest
}: ButtonProps) {
  const lead = busy ? <Spinner size={size === 'lg' ? 20 : 18} /> : iconLeft;
  const off = disabled || busy;
  return (
    <>
      <M3eButton
        {...(rest as object)}
        variant={M3E_BUTTON_VARIANTS[variant]}
        size={M3E_BUTTON_SIZES[size]}
        type={type}
        disabled={!!off}
        aria-busy={busy || undefined}
        data-variant={variant}
        className={cx(block && 'flex w-full', className)}
      >
        {lead && <span slot="icon" className="inline-flex">{lead}</span>}
        {children}
        {iconRight && <span slot="trailing-icon" className="inline-flex">{iconRight}</span>}
      </M3eButton>
      {/* Enter in a field submits a form through its first native submit
          button, and a browser counts no custom element as one: this stands
          in for M3E's, disabled when it is. */}
      {type === 'submit' && <button type="submit" hidden tabIndex={-1} aria-hidden form={rest.form} disabled={off} />}
    </>
  );
}

/** Below this, the loading indicator's shapes are a dot: Material sizes it from 24dp. */
const LOADING_INDICATOR_MIN = 24;

/**
 * A wait, in the text's colour. From 24px M3E's loading indicator (@m3e/web
 * loading-indicator): M3 Expressive's shapes morphing from one to the next as
 * it turns, the shape 38/48 of its box, as Material sizes it. Smaller — a
 * button's wait, a row's refresh — those shapes read as a still dot, so it is
 * M3E's indeterminate circular progress indicator, the arc that grows,
 * shrinks and turns, as Material puts a wait inside a control.
 */
export function Spinner({ className, size = 15, label }: { className?: string; size?: number; label?: string }) {
  const ring = size < LOADING_INDICATOR_MIN ? (
    <M3eCircularProgressIndicator
      indeterminate
      aria-hidden="true"
      data-spinner
      className={cx('shrink-0', className)}
      style={{
        width: size,
        height: size,
        '--m3e-circular-flat-progress-indicator-diameter': `${size}px`,
        '--m3e-circular-progress-indicator-thickness': `${Math.max(2, Math.round(size / 8 * 2) / 2)}px`,
        '--m3e-progress-indicator-color': 'currentColor',
        '--m3e-progress-indicator-track-color': 'transparent',
      } as CSSProperties}
    />
  ) : (
    <M3eLoadingIndicator
      aria-hidden="true"
      data-spinner
      className={cx('shrink-0', className)}
      style={{
        width: size,
        height: size,
        '--m3e-loading-indicator-container-size': `${size}px`,
        '--m3e-loading-indicator-active-indicator-size': `${Math.round((size * 38) / 48)}px`,
        '--m3e-loading-indicator-active-indicator-color': 'currentColor',
      } as CSSProperties}
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

export type IconButtonProps = Omit<ComponentProps<'button'>, 'ref' | 'onClick'> & {
  ref?: Ref<HTMLElement>;
  /** M3E's element dispatches it: a DOM MouseEvent, not React's. */
  onClick?: (e: MouseEvent) => void;
  /** Where it stands: the page, the top bar, or the balance's stage (their own inks). */
  tone?: 'page' | 'bar' | 'stage';
  /** sm 32 (M3's extra-small icon button) · md 40 (small) px. */
  size?: 'sm' | 'md';
  /** A glyph says nothing to a screen reader; the name is not optional. */
  'aria-label': string;
};

/**
 * M3E's standard icon button (@m3e/web icon-button). With aria-pressed it is
 * a toggle — selected, it takes the primary colour. A bar's controls live in
 * a band sized for the desktop title bar (--band-ctl,
 * app/material.css sizes them by it).
 */
export function IconButton({
  className, tone = 'page', size = 'sm', type = 'button', title, children, 'aria-pressed': pressed, ...rest
}: IconButtonProps) {
  const toggle = pressed !== undefined;
  return (
    <M3eIconButton
      {...(rest as object)}
      variant="standard"
      size={size === 'md' ? 'small' : 'extra-small'}
      type={type}
      disabled={!!rest.disabled}
      toggle={toggle}
      selected={toggle ? pressed === true || pressed === 'true' : undefined}
      // The caller's state says whether it is pressed; M3E's own flip on a click would run ahead of it.
      onBeforeInput={toggle ? (e: Event) => e.preventDefault() : undefined}
      aria-pressed={pressed}
      data-icon-button={size}
      data-tone={tone}
      // The name doubles as the hover tooltip, so a bare icon is never a guess.
      title={title ?? rest['aria-label']}
      className={cx('shrink-0', className)}
    >
      {children}
    </M3eIconButton>
  );
}

/**
 * Copies a value and says so — a check for 1.6 s and a polite announcement.
 * Goes through copyText, which also works under the desktop shell's
 * clipboard policy.
 */
export function CopyButton({
  text, label, tone = 'page', className,
}: { text: string; label?: string; tone?: 'page' | 'bar' | 'stage'; className?: string }) {
  const t = useT();
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
      <IconButton tone={tone} aria-label={label ?? t.shell.ui.copy} onClick={() => void copy()} className={className}>
        {state === 'done' ? (
          <CheckIcon size={16} strokeWidth={2.2} className={tone === 'page' ? 'text-green' : undefined} />
        ) : state === 'failed' ? (
          <XCircleIcon size={16} className={tone === 'page' ? 'text-red' : undefined} />
        ) : (
          <CopyIcon size={16} />
        )}
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {state === 'done' ? t.common.copied : state === 'failed' ? t.shell.ui.copyFailed : ''}
      </span>
    </span>
  );
}
