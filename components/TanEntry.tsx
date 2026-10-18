'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { flickerFrames } from '@/lib/flicker';
import { useT } from '@/lib/i18n/react';
import { cleanTan, isPlausibleTan, TAN_MAX } from '@/lib/tan-entry';
import type { TanEntry } from './FintsProvider';
import { MinusIcon, PauseIcon, PlusIcon, ResumeIcon } from './icons';
import { Field, IconButton, Input } from './ui';

// A typed TAN (components/TanWaitOverlay.tsx): what the bank shows to type it
// from — a flicker code for a chipTAN generator, a graphic to scan for chipTAN
// QR or photoTAN — and the field it is typed into. A method without either
// (smsTAN, chipTAN manuell) has the bank's challenge text alone, which the
// overlay shows above.

/** The graphic the TAN is made from, if the bank sent one. */
export function TanGraphic({ entry }: { entry: TanEntry }) {
  const te = useT().auth.tanWait.entry;
  if (entry.flicker) {
    return (
      <div className="mt-4">
        <FlickerGraphic code={entry.flicker} />
        <p className="mx-auto mt-3 max-w-[40ch] text-[13.5px] leading-snug text-ink-2">{te.flickerHint}</p>
      </div>
    );
  }
  if (entry.image) {
    return (
      <div className="mt-4">
        {/* White around it whatever the theme: a scanner needs the quiet zone. */}
        <div className="mx-auto w-fit rounded-[var(--radius-chip)] bg-white p-3">
          <img
            src={entry.image}
            alt={te.imageAlt}
            className="block size-[min(240px,62vw)] object-contain [image-rendering:pixelated]"
          />
        </div>
        <p className="mx-auto mt-3 max-w-[40ch] text-[13.5px] leading-snug text-ink-2">{te.imageHint}</p>
      </div>
    );
  }
  return null;
}

/** Width of the graphic in CSS px, and half-bytes shown per second — the user's last choice, kept. */
type FlickerPrefs = { width: number; speed: number };
const PREFS_KEY = 'fints.flicker';
const WIDTH = { min: 160, max: 420, step: 20, initial: 260 };
const SPEED = { min: 8, max: 40, step: 4, initial: 20 };
const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));

function readPrefs(): FlickerPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<FlickerPrefs> | null;
    return {
      width: clamp(Number(raw?.width) || WIDTH.initial, WIDTH),
      speed: clamp(Number(raw?.speed) || SPEED.initial, SPEED),
    };
  } catch {
    return { width: WIDTH.initial, speed: SPEED.initial };
  }
}

function writePrefs(p: FlickerPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* a preference, not data */ }
}

/**
 * chipTAN optisch: five bars on black — a clock and four data bits — that the
 * generator reads when held against them, its arrows on the two triangles.
 * Black and white whatever the theme: the generator's sensors read contrast,
 * not colour. The bars are switched straight in the DOM, not through React
 * state, so twenty frames a second re-render nothing.
 *
 * It flickers from the start, as the bank's own online banking does — unless
 * the system asks for less motion: then it waits for a click.
 */
function FlickerGraphic({ code }: { code: string }) {
  const te = useT().auth.tanWait.entry;
  const frames = useMemo(() => flickerFrames(code), [code]);
  const [prefs, setPrefs] = useState<FlickerPrefs>(() => ({ width: WIDTH.initial, speed: SPEED.initial }));
  const [playing, setPlaying] = useState(false);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    setPrefs(readPrefs());
    setPlaying(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let at = 0;
    const show = () => {
      const frame = frames[at];
      bars.current.forEach((bar, i) => { if (bar) bar.style.background = frame[i] ? '#fff' : '#000'; });
      at = (at + 1) % frames.length;
    };
    show();
    const timer = setInterval(show, 1000 / prefs.speed);
    return () => clearInterval(timer);
  }, [playing, frames, prefs.speed]);

  const change = (next: Partial<FlickerPrefs>) => {
    setPrefs((p) => {
      const v = { width: clamp(next.width ?? p.width, WIDTH), speed: clamp(next.speed ?? p.speed, SPEED) };
      writePrefs(v);
      return v;
    });
  };

  // Bars, gaps and the frame around them as shares of the width, so the
  // triangles stay over the outer bars at every size.
  const pad = Math.round(prefs.width * 0.05);
  const gap = Math.round(prefs.width * 0.04);

  return (
    <div role="group" aria-label={te.flicker}>
      <div className="mx-auto max-w-full" style={{ width: prefs.width }}>
        <div aria-hidden className="flex" style={{ gap, paddingInline: pad }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="flex flex-1 justify-center">
              {(i === 0 || i === 4) && (
                <span className="size-0 border-x-[7px] border-t-[10px] border-x-transparent border-t-ink" />
              )}
            </span>
          ))}
        </div>
        <div
          aria-hidden
          className="mt-1.5 flex rounded-[6px] bg-black"
          style={{ gap, padding: pad, height: Math.round(prefs.width * 0.42) }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} ref={(el) => { bars.current[i] = el; }} className="flex-1 bg-black" />
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-ink-2">
        <Stepper
          label={te.size}
          less={{ label: te.smaller, disabled: prefs.width <= WIDTH.min, run: () => change({ width: prefs.width - WIDTH.step }) }}
          more={{ label: te.larger, disabled: prefs.width >= WIDTH.max, run: () => change({ width: prefs.width + WIDTH.step }) }}
        />
        <Stepper
          label={te.speed}
          less={{ label: te.slower, disabled: prefs.speed <= SPEED.min, run: () => change({ speed: prefs.speed - SPEED.step }) }}
          more={{ label: te.faster, disabled: prefs.speed >= SPEED.max, run: () => change({ speed: prefs.speed + SPEED.step }) }}
        />
        <IconButton aria-label={playing ? te.pause : te.play} onClick={() => setPlaying(!playing)}>
          {playing ? <PauseIcon size={17} /> : <ResumeIcon size={17} />}
        </IconButton>
      </div>
    </div>
  );
}

function Stepper({ label, less, more }: {
  label: string;
  less: { label: string; disabled: boolean; run: () => void };
  more: { label: string; disabled: boolean; run: () => void };
}) {
  return (
    <span className="flex items-center gap-1">
      <IconButton aria-label={less.label} disabled={less.disabled} onClick={less.run}><MinusIcon size={16} /></IconButton>
      <span className="min-w-[5ch] text-center font-semibold">{label}</span>
      <IconButton aria-label={more.label} disabled={more.disabled} onClick={more.run}><PlusIcon size={16} /></IconButton>
    </span>
  );
}

/**
 * The TAN field. A form of its own, sent by the overlay's footer button (by
 * its id) or Enter. The keyboard is the digits' where the bank says the TAN
 * is digits only; "one-time-code" lets a phone offer the TAN from an SMS.
 */
export function TanForm({ entry, formId, inputRef, onSubmit }: {
  entry: TanEntry;
  formId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (tan: string) => void;
}) {
  const te = useT().auth.tanWait.entry;
  const uid = useId();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // A second TAN starts from an empty field.
  useEffect(() => {
    if (!entry.again) return;
    setValue('');
    inputRef.current?.focus();
  }, [entry.again, entry.image, entry.flicker, inputRef]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (entry.sending) return;
    const tan = cleanTan(value);
    const why = !tan ? te.missing
      : entry.numeric && !/^\d+$/.test(tan) ? te.digitsOnly
        : !isPlausibleTan(tan, entry.numeric) || (entry.maxLength && tan.length > entry.maxLength) ? te.invalid
          : null;
    setProblem(why);
    if (why) { inputRef.current?.focus(); return; }
    onSubmit(tan);
  };

  return (
    <form id={formId} onSubmit={send} noValidate className="mt-5 text-left">
      {entry.again && <p role="status" className="mb-3 text-[13.5px] leading-snug font-semibold text-ink">{te.again}</p>}
      <Field label={te.label} htmlFor={`tan${uid}`} error={problem} className="mb-0">
        <Input
          ref={inputRef}
          id={`tan${uid}`}
          value={value}
          onChange={(e) => { setValue(e.target.value); if (problem) setProblem(null); }}
          autoComplete="one-time-code"
          // Unknown is not "digits": a keyboard without letters would lock out a bank whose TANs have them.
          inputMode={entry.numeric ? 'numeric' : 'text'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={(entry.maxLength ?? TAN_MAX) + 8}
          disabled={entry.sending}
          className="tnum text-[20px] tracking-[0.12em]"
        />
      </Field>
    </form>
  );
}
