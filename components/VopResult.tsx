'use client';

// The bank's Namensabgleich (Verification of Payee) result.
//
// This is the one screen in the app whose wording is regulated: since the EU
// Instant Payments Regulation the bank compares the payee name against the name
// behind the IBAN, and its explanatory text has to reach the customer verbatim
// before they authorise a transfer that does not match. Hence `infoText` is
// rendered as-is and never paraphrased.

import type { SerializedVop, VopVerdict } from '@/lib/fints-types';
import { cx } from './ui';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const VERDICTS: Record<VopVerdict, { tone: Tone; label: string; blurb: string }> = {
  MATCH: {
    tone: 'ok',
    label: 'Name stimmt überein',
    blurb: 'Der Empfängername passt zu dem Namen, den die Bank zu dieser IBAN führt.',
  },
  CLOSE_MATCH: {
    tone: 'warn',
    label: 'Name weicht leicht ab',
    blurb: 'Die Bank führt zu dieser IBAN einen ähnlichen, aber nicht identischen Namen.',
  },
  NO_MATCH: {
    tone: 'bad',
    label: 'Name stimmt nicht überein',
    blurb: 'Der Empfängername passt nicht zu dem Namen, den die Bank zu dieser IBAN führt.',
  },
  NOT_APPLICABLE: {
    tone: 'neutral',
    label: 'Kein Abgleich möglich',
    blurb: 'Die Bank des Empfängers konnte den Namen nicht prüfen.',
  },
  PENDING: {
    tone: 'neutral',
    label: 'Prüfung läuft noch',
    blurb: 'Die Bank des Empfängers hat den Namen noch nicht zurückgemeldet.',
  },
  UNKNOWN: {
    tone: 'neutral',
    label: 'Prüfergebnis unklar',
    blurb: 'Die Bank hat ein Ergebnis geliefert, das sich nicht zuordnen lässt.',
  },
};

const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-green',
  warn: 'text-amber',
  bad: 'text-red',
  neutral: 'text-ink-2',
};

const TONE_CHIP: Record<Tone, string> = {
  ok: 'bg-green-soft text-green',
  warn: 'bg-amber-soft text-amber',
  bad: 'bg-red-soft text-red',
  neutral: 'bg-inset text-ink-2',
};

export const vopNeedsAttention = (v: SerializedVop) => VERDICTS[v.verdict].tone !== 'ok';

/** One line for the TAN overlay, where the approval already has the stage. */
export function VopBadge({ vop }: { vop: SerializedVop }) {
  const { tone, label } = VERDICTS[vop.verdict];
  return (
    <p className={cx('mx-auto mt-3.5 flex max-w-[340px] items-center justify-center gap-2 rounded-[9px] px-3.5 py-2 text-[12.5px]', TONE_CHIP[tone])}>
      <VerdictGlyph tone={tone} size={15} />
      <span className="font-semibold">Namensabgleich: {label}</span>
    </p>
  );
}

/** The full result, for the decision the user has to make before authorising. */
export function VopReport({ vop }: { vop: SerializedVop }) {
  const { tone, label, blurb } = VERDICTS[vop.verdict];
  return (
    <div className="mb-4">
      <div className={cx('flex items-start gap-3 rounded-[9px] px-3.5 py-3', TONE_CHIP[tone])}>
        <span className="mt-0.5 shrink-0"><VerdictGlyph tone={tone} size={20} /></span>
        <div>
          <p className="text-[14px] font-semibold">{label}</p>
          <p className="mt-0.5 text-[12.5px] opacity-85">{blurb}</p>
        </div>
      </div>

      <dl className="mt-3 overflow-hidden rounded-[9px] border border-line">
        <Row label="Von dir angegeben">{vop.submittedName}</Row>
        {vop.suggestedName && (
          <Row label="Bei der Bank hinterlegt">
            <span className={TONE_TEXT[tone]}>{vop.suggestedName}</span>
          </Row>
        )}
        {vop.reason && <Row label="Grund">{vop.reason}</Row>}
      </dl>

      {vop.infoText && (
        <p className="mt-3 rounded-[9px] bg-inset px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-line text-ink-2">
          {vop.infoText}
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3.5 border-b border-line px-3.5 py-2.5 last:border-b-0">
      <dt className="eyebrow shrink-0 pt-0.5">{label}</dt>
      <dd className="text-right text-[13.5px] break-words">{children}</dd>
    </div>
  );
}

function VerdictGlyph({ tone, size }: { tone: Tone; size: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      {tone === 'ok' && <path d="M4.5 12.5l5 5L19.5 7" {...common} />}
      {tone === 'warn' && <path d="M12 4v10m0 3.5v.4" {...common} />}
      {tone === 'bad' && <path d="M6 6l12 12M18 6L6 18" {...common} />}
      {tone === 'neutral' && <path d="M12 8v.4M12 11.5v5" {...common} />}
    </svg>
  );
}
