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
//
// Three kinds of answer, and the app's own words never blur them:
//   - a match;
//   - a deviation (Close Match, No Match): the bank found a different name;
//   - no result (Not Applicable, Pending, Unknown): nothing was compared, so
//     nothing "deviates" — but nobody confirmed the IBAN belongs to the name
//     either. Why there is no result is the bank's to say (its "Grund").

import type { ReactNode } from 'react';
import type { SerializedVop, VopVerdict } from '@/lib/fints-types';
import { fmtIban } from '@/lib/format';
import type { Messages } from '@/lib/i18n';
import { useT } from '@/lib/i18n/react';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XCircleIcon } from './icons';
import { Tag, cx } from './ui';

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const VERDICT_TONES: Record<VopVerdict, Tone> = {
  MATCH: 'ok',
  CLOSE_MATCH: 'warn',
  NO_MATCH: 'bad',
  NOT_APPLICABLE: 'neutral',
  PENDING: 'neutral',
  UNKNOWN: 'neutral',
};

/**
 * A verdict in words. Every verdict without a result also says that nothing
 * was compared and nothing confirmed.
 */
function verdictText(tr: Messages, verdict: VopVerdict): { label: string; blurb: string } {
  const words = tr.transfer.vop;
  const { label, blurb } = words.verdicts[verdict];
  return { label, blurb: VERDICT_TONES[verdict] === 'neutral' ? `${blurb} ${words.unconfirmed}` : blurb };
}

const TONES: Record<Tone, { box: string; icon: string; Glyph: typeof InfoIcon; tag: 'positive' | 'emphasis' | 'negative' | 'neutral' }> = {
  ok: { box: 'bg-green-soft shadow-[inset_3px_0_0_var(--green)]', icon: 'text-green', Glyph: CheckCircleIcon, tag: 'positive' },
  warn: { box: 'bg-inset shadow-[inset_3px_0_0_var(--emphasis)]', icon: 'text-emphasis', Glyph: AlertTriangleIcon, tag: 'emphasis' },
  bad: { box: 'bg-red-soft shadow-[inset_3px_0_0_var(--red)]', icon: 'text-red', Glyph: XCircleIcon, tag: 'negative' },
  neutral: { box: 'bg-info-soft shadow-[inset_3px_0_0_var(--info)]', icon: 'text-info', Glyph: InfoIcon, tag: 'neutral' },
};

/** The bank found a different name for the IBAN (Close Match, No Match). */
export const vopDeviates = (v: SerializedVop) => v.verdict === 'CLOSE_MATCH' || v.verdict === 'NO_MATCH';

/** Nothing was compared: Not Applicable, Pending, Unknown. */
export const vopUnchecked = (v: SerializedVop) => VERDICT_TONES[v.verdict] === 'neutral';

/** One line for the TAN overlay, where the approval already has the stage. */
export function VopBadge({ vop, className }: { vop: SerializedVop; className?: string }) {
  const tr = useT();
  const tone = VERDICT_TONES[vop.verdict];
  const { label } = verdictText(tr, vop.verdict);
  const t = TONES[tone];
  return (
    <p className={cx('mt-3.5 flex justify-center', className)}>
      <Tag tone={t.tag} icon={tone === 'warn' ? undefined : <t.Glyph size={14} className={t.icon} />}>
        {tr.transfer.vop.badge(label)}
      </Tag>
    </p>
  );
}

/**
 * The full result, for the decision the user has to make before authorising.
 * `iban`: the IBAN that was checked — the bank's echo of it, else the one sent.
 */
export function VopReport({ vop, iban, className }: { vop: SerializedVop; iban?: string | null; className?: string }) {
  const tr = useT();
  const words = tr.transfer.vop;
  const tone = VERDICT_TONES[vop.verdict];
  const { label, blurb } = verdictText(tr, vop.verdict);
  const t = TONES[tone];
  const checked = vop.iban || iban;
  return (
    <div className={className ?? 'mb-5'}>
      <div role="status" className={cx('flex items-start gap-3 rounded-[var(--radius-chip)] py-3.5 pr-4 pl-4', t.box)}>
        <t.Glyph size={22} className={cx('mt-px shrink-0', t.icon)} />
        <div className="min-w-0">
          <p className="text-[17px] leading-snug font-bold text-ink">{label}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-ink-2">{blurb}</p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-line border-y border-line">
        <Row label={words.submitted}>{vop.submittedName}</Row>
        {vop.suggestedName && (
          <Row label={words.suggested}>
            <span className="font-semibold text-ink">{vop.suggestedName}</span>
          </Row>
        )}
        {checked && (
          // A No Match can be the IBAN's fault as much as the name's — in
          // invoice fraud the name is right and the IBAN is not.
          <Row label="IBAN">
            <span className="iban block overflow-x-auto text-[14.5px] [scrollbar-width:none]">{fmtIban(checked)}</span>
          </Row>
        )}
        {vop.reason && <Row label={words.reason}>{vop.reason}</Row>}
      </dl>

      {vop.infoText && (
        <figure className="mt-4">
          <figcaption className="mb-1.5 text-[13px] font-semibold text-ink-2">{words.bankNote}</figcaption>
          <p className="rounded-[var(--radius-chip)] bg-inset px-4 py-3 text-[14px] leading-relaxed break-words whitespace-pre-line text-ink">
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
      <dd className="min-w-0 text-[15px] break-words text-ink sm:text-right">{children}</dd>
    </div>
  );
}
