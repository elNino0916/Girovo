'use client';

// "Belege" in the Umsatzdetails: an invoice or a till receipt for this
// booking, as a photo or a PDF — kept on this machine, sealed with the PIN
// (lib/doc-store.ts), under the booking's txKey. An invoice paid from its
// GiroCode arrives here by itself once its booking does (lib/receipts.ts).
//
// On Android a paper receipt is photographed with Google's document scanner
// (it finds the edges, crops and straightens): "Beleg hinzufügen" opens a
// menu, Foto aufnehmen or Datei wählen (owner's pick, 2026-10-24). Several
// pages are kept as one PDF. Without the scanner (no Play services) the
// system's picker opens instead, which offers the camera too.
//
// On the desktop a file dragged onto the section is kept as the booking's
// Beleg, and so is a screenshot or a PDF pasted while the section is in view
// (owner, 2026-10-24): an invoice on a computer is a mail attachment or a
// screenshot far more often than a paper to photograph.
//
// Not for a Vormerkposten: its key changes when the bank books it.

import { useEffect, useId, useRef, useState } from 'react';
import { txKey } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { DocRow } from '../DocRow';
import { useFints } from '../FintsProvider';
import { CameraIcon, PaperclipIcon, PlusIcon } from '../icons';
import { useFileDrop } from '../transfer/GiroCodeDrop';
import { Button, Menu, MenuItem, cx } from '../ui';

/** A pasted picture or PDF, if the clipboard carries one. */
function fileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const fits = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf';
  for (const f of Array.from(data.files ?? [])) if (fits(f)) return f;
  for (const item of Array.from(data.items ?? [])) {
    const f = item.kind === 'file' ? item.getAsFile() : null;
    if (f && fits(f)) return f;
  }
  return null;
}

export function ReceiptSection({ tx, pending }: { tx: SerializedTransaction; pending: boolean }) {
  const { receiptsOf, keepReceipt, activeAccount, toast } = useFints();
  const t = useT();
  const words = t.docs.receipts;
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const section = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file || !activeAccount) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      toast(words.wrongType, 'error');
      return;
    }
    setSaving(true);
    try {
      await keepReceipt(file, activeAccount.accountNumber, { tx: txKey(tx) });
    } finally {
      setSaving(false);
      if (input.current) input.current.value = '';
    }
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // The desktop: a file dropped on the section, or one pasted while the
  // section is in view — not from behind another layer (inert), nor while
  // its tab is not the one open (hidden).
  const { dragging, handlers } = useFileDrop(!IS_ANDROID && !pending && !saving, (f) => void pickRef.current(f ?? undefined));
  useEffect(() => {
    if (IS_ANDROID || pending) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = section.current;
      if (!el || el.closest('[hidden], [inert]')) return;
      const file = fileFromClipboard(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      // A screenshot comes as "image.png": named for the booking's day instead.
      const day = fmtDate(tx.entryDate || tx.valueDate);
      const ext = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'png');
      const named = /^image\.\w+$/.test(file.name) || !file.name ? new File([file], `${words.photoName(day)}.${ext}`, { type: file.type }) : file;
      void pickRef.current(named);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pending, tx.entryDate, tx.valueDate, words]);

  if (pending || !activeAccount) return null;
  const list = receiptsOf(tx);

  // The document scanner: one page as its JPEG, several as one PDF, named for the booking's day.
  const scan = async () => {
    const scanner = window.girovoMobile?.docScanner;
    const result = scanner ? await scanner.scan({ pages: 5, pdf: true }) : { unavailable: true as const };
    if ('unavailable' in result) {
      input.current?.click();
      return;
    }
    if ('failed' in result) {
      toast(words.scanFailed, 'error');
      return;
    }
    if ('canceled' in result) return;
    const file = result.pages.length > 1 && result.pdf ? result.pdf : result.pages[0];
    const day = fmtDate(tx.entryDate || tx.valueDate);
    const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
    await pick(new File([file], `${words.photoName(day)}.${ext}`, { type: file.type }));
  };

  return (
    <section ref={section} aria-labelledby={titleId} {...handlers} className="relative mt-6 border-t border-line pt-5">
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-2 top-2 -bottom-2 z-1 grid place-items-center rounded-[16px] border-2 border-dashed border-accent bg-[color-mix(in_srgb,var(--accent)_8%,var(--raised))] text-[15px] font-medium text-accent"
        >
          {words.dropHere}
        </div>
      )}
      <h3 id={titleId} className="text-[14px] font-semibold text-ink-2">{words.title}</h3>
      {list.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {list.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              title={d.name}
              removeLabel={words.removeLabel(d.name)}
              removeDialog={words.removeDialog}
            />
          ))}
        </ul>
      )}
      {IS_ANDROID ? (
        <Menu
          label={words.add}
          trigger={(p) => (
            <Button {...p} size="sm" variant="secondary" iconLeft={<PlusIcon size={16} />} busy={saving} className="mt-3">
              {words.add}
            </Button>
          )}
        >
          <MenuItem icon={<CameraIcon />} onSelect={() => void scan()}>{words.takePhoto}</MenuItem>
          <MenuItem icon={<PaperclipIcon />} onSelect={() => input.current?.click()}>{words.chooseFile}</MenuItem>
        </Menu>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<PaperclipIcon size={16} />}
          busy={saving}
          className="mt-3"
          onClick={() => input.current?.click()}
        >
          {words.attach}
        </Button>
      )}
      {/* The system's own picker: a file, or — on a phone — the camera. */}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {list.length === 0 && <p className="mt-2 text-[13px] leading-snug text-ink-3">{words.hint}</p>}
      {!IS_ANDROID && <p className={cx('text-[13px] leading-snug text-ink-3', list.length === 0 ? 'mt-1' : 'mt-2')}>{words.dropHint}</p>}
      <p className="sr-only" aria-live="polite">{saving ? words.attaching : ''}</p>
    </section>
  );
}
