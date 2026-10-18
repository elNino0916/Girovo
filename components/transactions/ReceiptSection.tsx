'use client';

// "Belege" in the Umsatzdetails: an invoice or a till receipt for this
// booking, as a photo or a PDF — kept on this machine, sealed with the PIN
// (lib/doc-store.ts), under the booking's txKey. An invoice paid from its
// GiroCode arrives here by itself once its booking does (lib/receipts.ts).
//
// Not for a Vormerkposten: its key changes when the bank books it.

import { useId, useRef, useState } from 'react';
import { txKey } from '@/lib/categories';
import type { SerializedTransaction } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { DocRow } from '../DocRow';
import { useFints } from '../FintsProvider';
import { PaperclipIcon } from '../icons';
import { Button } from '../ui';

export function ReceiptSection({ tx, pending }: { tx: SerializedTransaction; pending: boolean }) {
  const { receiptsOf, keepReceipt, activeAccount } = useFints();
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

  return (
    <section aria-labelledby={titleId} className="mt-6 border-t border-line pt-5">
      <h3 id={titleId} className="text-[15px] font-bold text-headline">{words.title}</h3>
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
