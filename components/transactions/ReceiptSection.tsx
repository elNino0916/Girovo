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
// Not for a Vormerkposten: its key changes when the bank books it.

import { useId, useRef, useState } from 'react';
import { txKey } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { DocRow } from '../DocRow';
import { useFints } from '../FintsProvider';
import { CameraIcon, PaperclipIcon, PlusIcon } from '../icons';
import { Button, Menu, MenuItem } from '../ui';

export function ReceiptSection({ tx, pending }: { tx: SerializedTransaction; pending: boolean }) {
  const { receiptsOf, keepReceipt, activeAccount, toast } = useFints();
  const t = useT();
  const words = t.docs.receipts;
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  if (pending || !activeAccount) return null;
  const list = receiptsOf(tx);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    try {
      await keepReceipt(file, activeAccount.accountNumber, { tx: txKey(tx) });
    } finally {
      setSaving(false);
      if (input.current) input.current.value = '';
    }
  };

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
    <section aria-labelledby={titleId} className="mt-6 border-t border-line pt-5">
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
      <p className="sr-only" aria-live="polite">{saving ? words.attaching : ''}</p>
    </section>
  );
}
