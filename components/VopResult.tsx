'use client';

// The bank's Namensabgleich (Verification of Payee) result.
//
// This is the one screen in the app whose wording is regulated: since the EU
// Instant Payments Regulation the bank compares the payee name against the name
// behind the IBAN, and its explanatory text has to reach the customer verbatim
// before they authorise a transfer that does not match. Hence `infoText` is
// rendered as-is (plain text, its own line breaks kept) and never paraphrased.
//
// Colour follows the app's roles: green only for the confirmed match, red for
// the mismatch, and the near-miss gets the neutral surface with the orange
// emphasis mark — amber is reserved for "vorgemerkt" and would say the wrong
// thing here. The verdict is always spelled out in words; colour only points.

import type { ReactNode } from 'react';
import type { SerializedVop, VopVerdict } from '@/lib/fints-types';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XCircleIcon } from './icons';
import { Tag, cx } from './ui';

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

const TONES: Record<Tone, { box: string; icon: string; Glyph: typeof InfoIcon; tag: 'positive' | 'emphasis' | 'negative' | 'neutral' }> = {
  ok: { box: 'bg-green-soft shadow-[inset_3px_0_0_var(--green)]', icon: 'text-green', Glyph: CheckCircleIcon, tag: 'positive' },
  warn: { box: 'bg-inset shadow-[inset_3px_0_0_var(--emphasis)]', icon: 'text-emphasis', Glyph: AlertTriangleIcon, tag: 'emphasis' },
  bad: { box: 'bg-red-soft shadow-[inset_3px_0_0_var(--red)]', icon: 'text-red', Glyph: XCircleIcon, tag: 'negative' },
  neutral: { box: 'bg-info-soft shadow-[inset_3px_0_0_var(--info)]', icon: 'text-info', Glyph: InfoIcon, tag: 'neutral' },
};

/** Anything but a clean match needs the user's explicit go-ahead. */
export const vopNeedsAttention = (v: SerializedVop) => VERDICTS[v.verdict].tone !== 'ok';

/** The short verdict, for places that only have room for a word. */
export const vopLabel = (v: SerializedVop) => VERDICTS[v.verdict].label;

/** One line for the TAN overlay, where the approval already has the stage. */
export function VopBadge({ vop, className }: { vop: SerializedVop; className?: string }) {
  const { tone, label } = VERDICTS[vop.verdict];
  const t = TONES[tone];
  return (
    <p className={cx('mt-3.5 flex justify-center', className)}>
      <Tag tone={t.tag} icon={tone === 'warn' ? undefined : <t.Glyph size={14} className={t.icon} />}>
        Namensabgleich: {label}
      </Tag>
    </p>
  );
}

/** The full result, for the decision the user has to make before authorising. */
export function VopReport({ vop, className }: { vop: SerializedVop; className?: string }) {
  const { tone, label, blurb } = VERDICTS[vop.verdict];
  const t = TONES[tone];
  return (
    <div className={className ?? 'mb-5'}>
      <div role="status" className={cx('flex items-start gap-3 rounded-[10px] py-3.5 pr-4 pl-4', t.box)}>
        <t.Glyph size={22} className={cx('mt-px shrink-0', t.icon)} />
        <div className="min-w-0">
          <p className="text-[16px] leading-snug font-bold text-ink">{label}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-ink-2">{blurb}</p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-line border-y border-line">
        <Row label="Von dir angegeben">{vop.submittedName}</Row>
        {vop.suggestedName && (
          <Row label="Bei der Bank hinterlegt">
            <span className="font-semibold text-ink">{vop.suggestedName}</span>
          </Row>
        )}
        {vop.reason && <Row label="Grund">{vop.reason}</Row>}
      </dl>

      {vop.infoText && (
        <figure className="mt-4">
          <figcaption className="mb-1.5 text-[13px] font-semibold text-ink-2">Hinweis deiner Bank</figcaption>
          <p className="rounded-[10px] bg-inset px-4 py-3 text-[14px] leading-relaxed break-words whitespace-pre-line text-ink">
            {vop.infoText}
          </p>
        </figure>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-[13px] font-semibold text-ink-3">{label}</dt>
      <dd className="text-[15px] break-words text-ink sm:text-right">{children}</dd>
    </div>
  );
}
