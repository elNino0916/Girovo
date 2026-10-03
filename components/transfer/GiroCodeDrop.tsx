'use client';

// "GiroCode einlesen": the QR code from an invoice, read off an image the
// user drops, pastes (Strg+V) or picks — never off the camera, which the
// desktop shell does not grant, and never through a web service: the pixels
// are decoded right here (lib/qr-read.ts, jsQR).
//
// What a code may fill in is decided by parseEpcPayload: only a SEPA credit
// transfer, only in euros, only to an IBAN whose checksum holds. Anything it
// fills goes through the same review step as typed values.

import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { parseEpcPayload, type EpcPayment } from '@/lib/girocode';
import { readQrFromBlob } from '@/lib/qr-read';
import { AlertTriangleIcon, QrIcon } from '../icons';
import { Spinner, cx } from '../ui';

export type ScanState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'error'; message: string };

const NOT_AN_IMAGE = 'Bitte wähle ein Bild (PNG, JPG oder einen Screenshot) mit dem GiroCode.';
const NO_CODE = 'Kein GiroCode gefunden. Nutze ein scharfes Bild, auf dem der Code vollständig zu sehen ist.';
const NOT_EPC = 'Kein gültiger GiroCode – unterstützt werden nur SEPA-Überweisungen in Euro.';

/** The first image among pasted or dropped files/items, if any. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const f of Array.from(data.files ?? [])) if (f.type.startsWith('image/')) return f;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

const carriesFiles = (data: DataTransfer | null) => !!data && Array.from(data.types ?? []).includes('Files');

/**
 * Reads a GiroCode from a file or from text and hands the payment over.
 * One scan at a time; a newer one wins over an older one still running.
 */
export function useGiroCodeReader(onPayment: (p: EpcPayment) => void) {
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const gen = useRef(0);
  const deliver = useRef(onPayment);
  deliver.current = onPayment;

  const readFile = useCallback(async (file: File | null | undefined) => {
    const mine = ++gen.current;
    if (!file || !file.type.startsWith('image/')) {
      setScan({ status: 'error', message: NOT_AN_IMAGE });
      return;
    }
    setScan({ status: 'reading' });
    const text = await readQrFromBlob(file);
    if (mine !== gen.current) return;
    if (!text) { setScan({ status: 'error', message: NO_CODE }); return; }
    const payment = parseEpcPayload(text);
    if (!payment) { setScan({ status: 'error', message: NOT_EPC }); return; }
    setScan({ status: 'idle' });
    deliver.current(payment);
  }, []);

  /** A GiroCode's text pasted as text ("BCD\n002\n…"); false when it is not one. */
  const readText = useCallback((text: string): boolean => {
    if (!/^\s*BCD\s*[\r\n]/.test(text)) return false;
    gen.current++;
    const payment = parseEpcPayload(text);
    if (!payment) { setScan({ status: 'error', message: NOT_EPC }); return true; }
    setScan({ status: 'idle' });
    deliver.current(payment);
    return true;
  }, []);

  const reset = useCallback(() => { gen.current++; setScan({ status: 'idle' }); }, []);

  return { scan, readFile, readText, reset };
}

/**
 * Drag-and-drop for a whole region (the sheet's body): `dragging` is true
 * while files hover over it, so the drop zone can light up wherever the
 * pointer is. Prevents the browser — and the desktop shell — from opening a
 * dropped file in place of the app.
 */
export function useFileDrop(enabled: boolean, onFile: (f: File | null) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!enabled || !carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!enabled || !carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!enabled || !carriesFiles(e.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!enabled) return;
      onFile(imageFromTransfer(e.dataTransfer) ?? e.dataTransfer.files?.[0] ?? null);
    },
  };
  return { dragging, handlers };
}

/**
 * The visible way in: a dashed strip that is also the file picker's button.
 * The drag and paste hints only appear where a mouse and keyboard are likely.
 */
export function GiroCodeDrop({
  scan, dragging, onFile, className,
}: {
  scan: ScanState;
  dragging: boolean;
  onFile: (f: File | null) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const reading = scan.status === 'reading';
  const errorId = 'girocode-error';

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={reading}
        aria-describedby={scan.status === 'error' ? errorId : undefined}
        className={cx(
          'group flex min-h-13 w-full items-center gap-3 rounded-[10px] border-[1.5px] border-dashed px-3.5 py-2.5 text-left',
          'transition-[background-color,border-color] duration-150 disabled:cursor-progress',
          dragging
            ? 'border-accent bg-accent-soft'
            : 'border-line-strong hover:border-accent hover:bg-[color-mix(in_srgb,var(--accent-soft)_55%,transparent)]',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-150',
            dragging ? 'bg-accent text-accent-ink' : 'bg-accent-soft text-accent',
          )}
        >
          {reading ? <Spinner size={16} /> : <QrIcon size={18} />}
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block text-[14.5px] font-semibold text-accent">
            {reading ? 'GiroCode wird gelesen …' : dragging ? 'Bild hier ablegen' : 'GiroCode einlesen'}
          </span>
          <span className="block text-[13px] text-ink-3">
            {reading ? 'Einen Moment bitte.' : (
              <>
                <span className="pointer-fine:hidden">Bild mit dem Code auswählen</span>
                <span className="hidden pointer-fine:inline">Bild hierher ziehen, mit Strg+V einfügen oder auswählen</span>
              </>
            )}
          </span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = ''; // the same file again must fire a change
          if (f) onFile(f);
        }}
      />
      <span className="sr-only" role="status">{reading ? 'GiroCode wird gelesen' : ''}</span>
      {scan.status === 'error' && (
        <p id={errorId} role="alert" className="mt-2 flex items-start gap-1.5 text-[13.5px] leading-snug font-semibold text-red">
          <AlertTriangleIcon size={16} className="mt-px" />
          <span>{scan.message}</span>
        </p>
      )}
    </div>
  );
}
