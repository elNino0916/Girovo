'use client';

import { useEffect, useState } from 'react';
import { isImage } from '@/lib/docs';
import { fmtBytes, fmtDate } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { useFints, type ListedDoc } from './FintsProvider';
import { DownloadIcon, ExternalIcon, FileIcon, TrashIcon } from './icons';
import { Button, Dialog, IconButton } from './ui';

// One kept document in a list — a receipt on a booking, one of the bank's
// Kontoauszüge: what it is, and the ways to it. On the phone the first is
// "Öffnen" (the share sheet hands it to a viewer), on the desktop "Speichern"
// (the window opens no files of its own); an image shows itself in small and,
// pressed, large. Removing it asks first: it is the only copy here.

/** A kept image as an object URL, for as long as the component shows it. */
function useDocUrl(doc: ListedDoc, wanted: boolean): string | null {
  const { readDoc } = useFints();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    let made: string | null = null;
    readDoc(doc).then((blob) => {
      if (!alive) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    }).catch(() => { /* the row still offers it to save */ });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [doc, wanted, readDoc]);
  return url;
}

export function DocRow({ doc, title, detail, removeLabel, removeDialog }: {
  doc: ListedDoc;
  title: string;
  /** The line under the title; size and day by default. */
  detail?: string;
  /** The remove button's name ("Beleg „Rechnung.pdf“ entfernen"), and the question it asks. */
  removeLabel: string;
  removeDialog: { title: string; description: string; confirm: string };
}) {
  const { openDoc, removeDoc } = useFints();
  const t = useT();
  const image = isImage(doc.mime);
  const thumb = useDocUrl(doc, image);
  const [large, setLarge] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      {image && thumb ? (
        <button
          type="button"
          onClick={() => setLarge(true)}
          aria-label={title}
          className="size-11 shrink-0 overflow-hidden rounded-[8px] border border-line bg-inset"
        >
          <img src={thumb} alt="" className="size-full object-cover" />
        </button>
      ) : (
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-inset text-ink-2">
          <FileIcon size={20} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] leading-snug font-semibold text-ink">{title}</span>
        <span className="tnum block truncate text-[13px] leading-snug text-ink-3">
          {detail ?? `${fmtBytes(doc.size)} · ${fmtDate(doc.addedAt)}`}
        </span>
      </span>
      <Button
        size="xs"
        variant="tertiary"
        iconLeft={IS_ANDROID ? <ExternalIcon size={15} /> : <DownloadIcon size={15} />}
        onClick={() => void openDoc(doc, IS_ANDROID ? 'open' : 'save')}
      >
        {IS_ANDROID ? t.docs.open : t.docs.save}
      </Button>
      <IconButton aria-label={removeLabel} onClick={() => setConfirm(true)}>
        <TrashIcon size={16} />
      </IconButton>

      {image && thumb && (
        <Dialog
          open={large}
          onClose={() => setLarge(false)}
          title={title}
          actions={<Button variant="primary" onClick={() => setLarge(false)}>{t.common.close}</Button>}
        >
          <img src={thumb} alt={title} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-[8px]" />
        </Dialog>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={removeDialog.title}
        description={removeDialog.description}
        actions={
          <>
            <Button onClick={() => setConfirm(false)}>{t.common.cancel}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirm(false);
                void removeDoc(doc);
              }}
            >
              {removeDialog.confirm}
            </Button>
          </>
        }
      />
    </li>
  );
}
