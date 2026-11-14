'use client';

// "Kündigungsschreiben": a contract's cancellation letter (lib/cancel-letter.ts),
// offered on the contract in Verträge & Abos and by Girovo AI ("Kündige mein
// Fitnessstudio"). The user adds the customer number and, where they know it,
// the day the contract ends; the letter shows as it will read, with the gaps
// Girovo cannot fill marked. It leaves as text, as a PDF (the print sheet in
// components/Statement.tsx) or, on the desktop, as an e-mail in the user's own
// mail program. Girovo never sends it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFints } from '../FintsProvider';
import { CheckIcon, CopyIcon, FileIcon, MailIcon } from '../icons';
import { holderName, sessionHolder } from '../shell/session';
import { Button, Dialog, Field, Input } from '../ui';
import { cancelLetter, letterFileName, letterMailto } from '@/lib/cancel-letter';
import { copyText } from '@/lib/clipboard';
import { dayKey } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/react';
import { IS_ANDROID } from '@/lib/platform';
import { seriesTitle, type RecurringSeries } from '@/lib/recurring';
import { useRecurringModel } from './recurring-model';

/** The letter's text with its gaps ("[PLZ und Ort]") marked. */
function Preview({ text, label }: { text: string; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="row-focus max-h-[min(18rem,30vh)] overflow-auto rounded-[12px] bg-inset px-4 py-3 text-[14px] leading-[22px] whitespace-pre-wrap text-ink [overflow-wrap:anywhere]"
    >
      {text.split(/(\[[^\]\n]+\])/).map((part, i) => (i % 2
        ? <span key={i} className="rounded-[4px] bg-accent-soft px-0.5 text-accent">{part}</span>
        : part))}
    </div>
  );
}

/** Opens a mailto link the way a link with target _blank does: the desktop shell hands it to the mail program. */
function openMail(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

export function CancelLetterDialog({ s, end: givenEnd = null, onClose }: {
  s: RecurringSeries;
  /** The day it ends, when the user said so ("Kündige Netflix zum 31.12."). */
  end?: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const words = t.insights.contracts.letter;
  const { accounts, vault, printLetter } = useFints();
  const model = useRecurringModel();
  const [number, setNumber] = useState('');
  const [end, setEnd] = useState(givenEnd ?? '');
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const numberRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const title = seriesTitle(s) || t.insights.noName;
  // The holder of the account it is paid from, else the session's.
  const holder = useMemo(() => {
    const acct = model.accountOf(s);
    const own = accounts.find((a) => a.accountNumber === acct)?.holder?.trim();
    return holderName(own || sessionHolder(accounts));
  }, [model, s, accounts]);
  const letter = useMemo(() => cancelLetter({
    holder,
    contract: title,
    today: dayKey(new Date()),
    endDay: end || null,
    noticeBy: vault?.contractReminders?.[s.id]?.by ?? null,
    creditorId: s.creditorId,
    mandateReference: s.mandateReference,
    directDebit: s.directDebit,
    customerNumber: number,
  }, locale), [holder, title, end, vault?.contractReminders, s, number, locale]);

  const copy = async () => {
    const ok = await copyText(letter.text);
    setCopied(ok ? 'done' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied('idle'), 1600);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      onBackdrop={number || end !== (givenEnd ?? '') ? () => {} : undefined}
      size="md"
      title={words.title}
      description={words.description(title)}
      initialFocus={numberRef}
      actions={(
        <>
          <Button
            variant="secondary"
            iconLeft={copied === 'done' ? <CheckIcon size={18} strokeWidth={2.2} /> : <CopyIcon size={18} />}
            onClick={() => void copy()}
          >
            {copied === 'done' ? words.copied : words.copy}
          </Button>
          <Button variant="secondary" iconLeft={<FileIcon size={18} />} onClick={() => printLetter(letter, letterFileName(title, locale))}>
            {words.pdf}
          </Button>
          {/* The desktop: the user's own mail program, the address left to them. */}
          {!IS_ANDROID && (
            <Button variant="secondary" iconLeft={<MailIcon size={18} />} onClick={() => openMail(letterMailto(letter))}>
              {words.mail}
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>{t.common.close}</Button>
        </>
      )}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={words.number} htmlFor="letter-number" hint={words.numberHint}>
          <Input id="letter-number" ref={numberRef} value={number} maxLength={60} onChange={(e) => setNumber(e.target.value)} />
        </Field>
        <Field label={words.end} htmlFor="letter-end" hint={words.endHint}>
          <Input id="letter-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="tnum" />
        </Field>
      </div>
      <Preview text={letter.text} label={words.preview} />
      <p className="mt-2 text-[13px] leading-snug text-ink-3">{words.fill}</p>
      <span className="sr-only" aria-live="polite">
        {copied === 'done' ? words.copied : copied === 'failed' ? t.shell.ui.copyFailed : ''}
      </span>
    </Dialog>
  );
}
