'use client';

// The IBAN field: grouped in fours as you type, caret kept in place, a pasted
// "IBAN: DE12 …" cleaned up, and — for a German IBAN — the bank named from the
// app's own institute list, so a typo in the BLZ shows up as the wrong bank
// before the order is sent.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, Ref } from 'react';
import { get } from '@/lib/client-api';
import type { BankSearchHit } from '@/lib/fints-types';
import { ibanCountry } from '@/lib/format';
import { LandmarkIcon } from '../icons';
import { Input, Spinner, type InputProps } from '../ui';
import { IBAN_MAX_FORMATTED, isSepaIban, regroup, stripIbanLabel } from './iban';

export type IbanInputProps = Omit<InputProps, 'value' | 'onChange' | 'ref'> & {
  value: string;
  /** The grouped value, ready to show back. */
  onValueChange: (grouped: string) => void;
  inputRef?: Ref<HTMLInputElement>;
};

export function IbanInput({ value, onValueChange, inputRef, onKeyDown, onPaste, className, ...rest }: IbanInputProps) {
  const own = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  // After React writes the regrouped value, put the caret back where the
  // person was typing — a controlled input otherwise jumps to the end.
  useLayoutEffect(() => {
    const el = own.current;
    const at = caret.current;
    caret.current = null;
    if (el && at != null && document.activeElement === el) el.setSelectionRange(at, at);
  }, [value]);

  const apply = (input: string, at: number) => {
    const next = regroup(input, at);
    caret.current = next.caret;
    onValueChange(next.value);
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const el = e.currentTarget;
    const s = el.selectionStart ?? 0;
    if (s !== el.selectionEnd) return;
    // Deleting "across" a group space: the space would only come straight
    // back, so the character beyond it goes instead.
    if (e.key === 'Backspace' && s > 1 && value[s - 1] === ' ') {
      e.preventDefault();
      apply(value.slice(0, s - 2) + value.slice(s), s - 2);
    } else if (e.key === 'Delete' && value[s] === ' ') {
      e.preventDefault();
      apply(value.slice(0, s + 1) + value.slice(s + 2), s + 1);
    }
  };

  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(e);
    if (e.defaultPrevented) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    // Only the first line: an IBAN copied out of an invoice often brings
    // the BIC line below it along.
    const cleaned = stripIbanLabel(text.split(/\r?\n/).find((l) => l.trim()) ?? '');
    const el = e.currentTarget;
    const s = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? s;
    apply(value.slice(0, s) + cleaned + value.slice(end), s + cleaned.length);
  };

  return (
    <Input
      {...rest}
      ref={(el) => {
        own.current = el;
        if (typeof inputRef === 'function') inputRef(el);
        else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
      }}
      value={value}
      onChange={(e) => apply(e.target.value, e.target.selectionStart ?? e.target.value.length)}
      onKeyDown={keyDown}
      onPaste={paste}
      maxLength={IBAN_MAX_FORMATTED}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="characters"
      spellCheck={false}
      inputMode="text"
      className={className ?? 'iban'}
    />
  );
}

// ---------------------------------------------------------------------------
// Bank lookup — a German IBAN carries the BLZ in places 5–12.
// ---------------------------------------------------------------------------

export type BankInfo = { name: string; bic: string; location: string };
export type BankLookup =
  | { status: 'loading' }
  | { status: 'found'; bank: BankInfo }
  | { status: 'none' };

// One answer per BLZ for the whole session: the list is the app's own and
// does not change while it runs.
const lookups = new Map<string, BankInfo | null>();

/**
 * The institute behind a valid German IBAN, from the local bank list behind
 * /api/bank-search (no third party is asked). Null for anything else.
 */
export function useBankLookup(raw: string, valid: boolean): BankLookup | null {
  const blz = valid && raw.startsWith('DE') && raw.length === 22 ? raw.slice(4, 12) : null;
  const [, rerender] = useState(0);
  // A request that failed (server restarting, offline) says nothing about
  // the bank, so the field simply shows no bank rather than "unknown".
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!blz || lookups.has(blz)) return;
    let alive = true;
    // Debounced: a pasted IBAN settles at once, but a typed one passes
    // through valid-looking intermediate states only at the very end anyway.
    const t = setTimeout(async () => {
      try {
        const hits = await get<BankSearchHit[]>(`/api/bank-search?q=${encodeURIComponent(blz)}`);
        const hit = Array.isArray(hits) ? hits.find((h) => h.blz === blz) : undefined;
        lookups.set(blz, hit ? { name: hit.name, bic: hit.bic, location: hit.location } : null);
      } catch {
        // Not cached: the next valid IBAN with this BLZ may ask again.
        if (alive) setFailed(blz);
        return;
      }
      if (alive) rerender((n) => n + 1);
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [blz]);

  if (!blz || failed === blz) return null;
  if (!lookups.has(blz)) return { status: 'loading' };
  const bank = lookups.get(blz);
  return bank ? { status: 'found', bank } : { status: 'none' };
}

/** What the field can say about an IBAN that passes: its bank, or at least that it is valid. */
export function IbanHint({ raw, ok, lookup }: { raw: string; ok: boolean; lookup: BankLookup | null }) {
  if (!ok) {
    if (/^[A-Z]{2}/.test(raw) && !isSepaIban(raw)) return <>SEPA-Überweisungen erreichen nur Konten im SEPA-Raum.</>;
    return null;
  }
  if (lookup?.status === 'loading') {
    return <span className="inline-flex items-center gap-1.5"><Spinner size={12} />Bank wird gesucht …</span>;
  }
  if (lookup?.status === 'found') {
    return (
      <span className="inline-flex min-w-0 items-start gap-1.5 text-ink-2">
        <LandmarkIcon size={15} className="mt-0.5 shrink-0 text-ink-3" />
        <span className="min-w-0">
          <span className="font-semibold">{lookup.bank.name}</span>
          {lookup.bank.bic && <span className="text-ink-3"> · <span className="num text-[12.5px]">{lookup.bank.bic}</span></span>}
        </span>
      </span>
    );
  }
  if (lookup?.status === 'none') return <>IBAN gültig. Die Bank ist im Verzeichnis nicht hinterlegt.</>;
  const country = ibanCountry(raw);
  return <>IBAN gültig{country && !raw.startsWith('DE') ? ` · Konto in ${country.name}` : ''}.</>;
}
