'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet';
  size?: 'md' | 'sm';
  block?: boolean;
  busy?: boolean;
};

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[9px] border font-semibold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,opacity] duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

const BUTTON_VARIANTS = {
  primary: 'border-transparent bg-green text-white dark:text-[#07130e] hover:brightness-110',
  ghost: 'border-line-strong text-ink-2 hover:bg-inset hover:text-ink',
  quiet: 'border-transparent text-ink-3 hover:bg-inset hover:text-ink',
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', block, busy, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || busy}
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-[18px] py-2.5 text-sm',
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block size-[15px] shrink-0 rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      style={{ animation: 'spin .7s linear infinite' }}
    />
  );
}

export function IconButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        'grid size-8 shrink-0 place-items-center rounded-lg text-ink-3',
        'transition-colors duration-150 hover:bg-inset hover:text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------
export function Field({
  label, htmlFor, hint, children, trailing,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1.5">
      <div className="flex items-baseline">
        <label htmlFor={htmlFor} className="eyebrow">{label}</label>
        {trailing}
      </div>
      {children}
      {hint}
    </div>
  );
}

const INPUT_BASE =
  'w-full rounded-[9px] border border-line-strong bg-surface px-3 py-2.5 text-ink ' +
  'transition-[border-color,box-shadow] duration-150 outline-none ' +
  'focus:border-green focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--green)_18%,transparent)]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} className={cx(INPUT_BASE, invalid && 'border-red', className)} {...rest} />;
  },
);

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(INPUT_BASE, 'appearance-none pr-9', className)} {...rest}>
      {children}
    </select>
  );
}

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'warn' | 'info'; children: ReactNode }) {
  const tones = {
    error: 'bg-red-soft text-red',
    warn: 'bg-amber-soft text-amber',
    info: 'bg-green-soft text-green',
  } as const;
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={cx('mt-3 rounded-[9px] px-3 py-2.5 text-[13.5px]', tones[tone])}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------
export function Overlay({
  open, onClose, align = 'center', labelledBy, children,
}: {
  open: boolean;
  onClose?: () => void;
  align?: 'center' | 'right';
  labelledBy?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={(e) => { if (onClose && e.target === e.currentTarget) onClose(); }}
      className={cx(
        'anim-fade fixed inset-0 z-100 flex bg-[rgb(6_12_9/0.5)] backdrop-blur-[2px]',
        align === 'right' ? 'justify-end' : 'items-center justify-center p-5',
      )}
    >
      {children}
    </div>
  );
}

export function Sheet({ wide, className, children }: { wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        'anim-sheet max-h-[calc(100dvh-40px)] w-full overflow-y-auto rounded-2xl border border-line',
        'bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-7',
        wide ? 'max-w-[540px]' : 'max-w-[460px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ShieldIcon({ size = 14, check = false }: { size?: number; check?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <path d="M12 2l7 3v6c0 4.5-3 8.3-7 9.5C8 19.3 5 15.5 5 11V5l7-3z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      {check && <path d="M9 11.5l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RefreshIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M12 5v13m0 0l-5-5m5 5l5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Skeleton row — one placeholder transaction.
// ---------------------------------------------------------------------------
export function SkeletonRow({ width = 60 }: { width?: number }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="skel size-9 shrink-0 rounded-full" />
      <div className="flex-1">
        <div className="skel h-[11px]" style={{ width: `${width}%` }} />
        <div className="skel mt-[7px] h-[11px]" style={{ width: `${Math.max(20, width - 18)}%` }} />
      </div>
      <div className="skel h-[13px] w-16" />
    </div>
  );
}
