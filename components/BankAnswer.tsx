'use client';

// A bank's answer in an error alert: its sentences word for word, the return
// codes small underneath for whoever calls the bank about it — never the
// "9931: … | 9800: …" the wire carries (lib/bank-answer.ts).

import type { ReactNode } from 'react';
import { formatBankAnswer } from '@/lib/bank-answer';
import { Alert } from './ui';

export function BankAnswerAlert({
  message, children, className,
}: {
  message: string;
  /** The screen's own next step, after the bank's words. */
  children?: ReactNode;
  className?: string;
}) {
  const answer = formatBankAnswer(message);
  return (
    <Alert tone="error" className={className}>
      {answer.lines.map((line) => <p key={line}>{line}</p>)}
      {children}
      {answer.codes.length > 0 && (
        <p className="tnum mt-1.5 text-[12.5px] text-ink-3">Rückmeldung der Bank: {answer.codes.join(', ')}</p>
      )}
    </Alert>
  );
}
