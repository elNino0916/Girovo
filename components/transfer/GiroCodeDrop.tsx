'use client';

// "GiroCode einlesen": the QR code from an invoice, read off an image the
// user drops, pastes (Strg+V) or picks — never off the camera, which the
// desktop shell does not grant, and never through a web service: the pixels
// are decoded right here (lib/qr-read.ts, jsQR).
//
// The Android app has the camera: "GiroCode scannen" is Google's code scanner
// (android/…/ScannerPlugin.java), which hands back the code's text and no
// picture. It also reads a PDF — the phone draws its first pages as images.
//
// What a code may fill in is decided by parseEpcPayload: only a SEPA credit
// transfer, only in euros, only to an IBAN whose checksum holds. Anything it
// fills goes through the same review step as typed values.

import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { parseEpcPayload, type EpcPayment } from '@/lib/girocode';
import { useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { readQrFromBlob } from '@/lib/qr-read';
import { AlertTriangleIcon, QrIcon, ScanIcon } from '../icons';
import { Button, Spinner, cx } from '../ui';

/**
 * Why a scan came to nothing: not an image (on Android: nor a PDF), no code
 * found on it, a code that is not a SEPA transfer in euros, or no scanner on
 * the phone. Worded where it is shown.
 */
export type ScanProblem = 'notAnImage' | 'notAnImageOrPdf' | 'noCode' | 'notEpc' | 'noScanner' | 'scanFailed';

export type ScanState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'error'; problem: ScanProblem };

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
    const pdfPages = IS_ANDROID && file?.type === 'application/pdf' ? window.girovoMobile?.pdfPages : undefined;
    if (!file || (!file.type.startsWith('image/') && !pdfPages)) {
      setScan({ status: 'error', problem: IS_ANDROID ? 'notAnImageOrPdf' : 'notAnImage' });
      return;
    }
    setScan({ status: 'reading' });
    let text: string | null = null;
    try {
      // A PDF's first pages, one after the other, until one has the code.
      for (const image of pdfPages ? await pdfPages(file) : [file]) {
        text = await readQrFromBlob(image);
        if (text || mine !== gen.current) break;
      }
    } catch {
      text = null;
    }
    if (mine !== gen.current) return;
    if (!text) { setScan({ status: 'error', problem: 'noCode' }); return; }
    const payment = parseEpcPayload(text);
    if (!payment) { setScan({ status: 'error', problem: 'notEpc' }); return; }
    setScan({ status: 'idle' });
    deliver.current(payment);
  }, []);

  /** A GiroCode's text pasted as text ("BCD\n002\n…"); false when it is not one. */
  const readText = useCallback((text: string): boolean => {
    if (!/^\s*BCD\s*[\r\n]/.test(text)) return false;
    gen.current++;
    const payment = parseEpcPayload(text);
    if (!payment) { setScan({ status: 'error', problem: 'notEpc' }); return true; }
    setScan({ status: 'idle' });
    deliver.current(payment);
    return true;
  }, []);

  /** Android: Google's code scanner, its text read as a GiroCode. */
  const scanCamera = useCallback(async () => {
    const scanner = window.girovoMobile?.scanner;
    if (!scanner) return;
    const mine = ++gen.current;
    setScan({ status: 'idle' });
    const result = await scanner.scan();
    if (mine !== gen.current || 'canceled' in result) return;
    if ('unavailable' in result) { setScan({ status: 'error', problem: 'noScanner' }); return; }
    if ('failed' in result) { setScan({ status: 'error', problem: 'scanFailed' }); return; }
    const payment = parseEpcPayload(result.value);
    if (!payment) { setScan({ status: 'error', problem: 'notEpc' }); return; }
    deliver.current(payment);
  }, []);

  const reset = useCallback(() => { gen.current++; setScan({ status: 'idle' }); }, []);

  return { scan, readFile, readText, scanCamera, reset };
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
  scan, dragging, onFile, onScan, className,
}: {
  scan: ScanState;
  dragging: boolean;
  onFile: (f: File | null) => void;
  /** Android: the camera. */
  onScan?: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const words = useT().transfer.giro;
  const reading = scan.status === 'reading';
  const errorId = 'girocode-error';

  // The phone: the camera first, an image or a PDF of the invoice beside it.
  if (IS_ANDROID && onScan) {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            iconLeft={reading ? <Spinner size={16} /> : <ScanIcon size={18} />}
            disabled={reading}
            aria-describedby={scan.status === 'error' ? errorId : undefined}
            onClick={onScan}
          >
            {reading ? words.reading : words.scan}
          </Button>
          <Button variant="tertiary" disabled={reading} onClick={() => input.current?.click()}>
            {words.fromFile}
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
        <span className="sr-only" role="status">{reading ? words.readingStatus : ''}</span>
        {scan.status === 'error' && (
          <p id={errorId} role="alert" className="mt-2 flex items-start gap-1.5 text-[14px] leading-snug font-semibold text-red">
            <AlertTriangleIcon size={16} className="mt-0.5 shrink-0" />
            <span>{words.errors[scan.problem]}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={reading}
        aria-describedby={scan.status === 'error' ? errorId : undefined}
        className={cx(
          'group flex min-h-13 w-full items-center gap-3 rounded-[var(--radius-chip)] border-[1.5px] border-dashed px-3.5 py-2.5 text-left',
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
            {reading ? words.reading : dragging ? words.dropHere : words.read}
          </span>
          <span className="block text-[13px] text-ink-3">
            {reading ? words.wait : (
              <>
                <span className="pointer-fine:hidden">{words.pick}</span>
                <span className="hidden pointer-fine:inline">{words.pickOrDrop}</span>
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
      <span className="sr-only" role="status">{reading ? words.readingStatus : ''}</span>
      {scan.status === 'error' && (
        <p id={errorId} role="alert" className="mt-2 flex items-start gap-1.5 text-[13.5px] leading-snug font-semibold text-red">
          <AlertTriangleIcon size={16} className="mt-px" />
          <span>{words.errors[scan.problem]}</span>
        </p>
      )}
    </div>
  );
}
