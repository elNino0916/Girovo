'use client';

// "Kontoauszüge deiner Bank": the statements the bank itself provides for an
// account over FinTS (HKEKA) — fetched on request, and every one kept on
// this machine as it arrives, sealed with the PIN (lib/bank-statements.ts,
// lib/doc-store.ts). Beside, not instead of, Girovo's own Kontoauszug, which
// is made from the loaded Umsätze.
//
// Why each is kept is said while none is: some banks hand a statement out
// once and mark it as delivered. The drawer's one fetch carries the approval
// note; the export menu that opens it does not.

import { useMemo } from 'react';
import { byStatementOrder, statementTitle } from '@/lib/docs';
import type { SerializedAccount } from '@/lib/fints-types';
import { fmtBytes, fmtDate, fmtRange } from '@/lib/format';
import { useT } from '@/lib/i18n/react';
import { DocRow } from './DocRow';
import { useFints } from './FintsProvider';
import { FileIcon, RefreshIcon } from './icons';
import { Alert, Button, Drawer, EmptyState } from './ui';

export function BankStatements({ account, open, onClose }: { account: SerializedAccount; open: boolean; onClose: () => void }) {
  const {
    docs, docsLocked, busy, bankStatementsLoading, statementFetches, fetchBankStatements, accountLabel,
  } = useFints();
  const t = useT();
  const words = t.docs.statements;
  const acct = account.accountNumber;
  const loading = bankStatementsLoading === acct;
  const last = statementFetches[acct];
  const list = useMemo(
    () => docs.filter((d) => d.kind === 'statement' && d.accountNumber === acct).sort(byStatementOrder),
    [docs, acct],
  );
  const titleOf = (d: (typeof list)[number]) => statementTitle(d, words);

  return (
    <Drawer open={open} onClose={onClose} title={words.title} bodyClassName="px-4 pt-5 pb-8 sm:px-6">
      <p className="text-[15px] leading-snug font-semibold text-ink">{accountLabel(account)}</p>
      <p className="mt-1 text-[14px] leading-snug text-ink-2">{words.intro}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" size="sm" iconLeft={<RefreshIcon size={16} />} busy={loading} disabled={busy && !loading} onClick={() => void fetchBankStatements(account)}>
          {loading ? words.fetching : words.fetch}
        </Button>
        <span className="text-[13px] leading-snug text-ink-3">{t.common.mayNeedApproval}</span>
      </div>

      {/* How the last fetch went: new ones, none, more waiting, or the bank's no. */}
      <div role="status" aria-live="polite">
        {last && !loading && (last.error ? (
          <Alert tone="error" className="mt-4">{last.error}</Alert>
        ) : last.answer && (
          <Alert tone={last.answer.held ? 'warn' : last.answer.added ? 'success' : 'info'} className="mt-4">
            <p>{last.answer.added ? words.added(last.answer.added) : words.nothingNew}</p>
            {last.answer.more && <p className="mt-1">{words.more}</p>}
            {last.answer.held && <p className="mt-1">{words.held}</p>}
          </Alert>
        ))}
      </div>
      {docsLocked && <Alert tone="warn" className="mt-4">{words.locked}</Alert>}

      {list.length ? (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {list.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              title={titleOf(d)}
              detail={[
                d.from && d.to ? fmtRange(d.from, d.to) : d.date ? fmtDate(d.date) : '',
                fmtBytes(d.size),
              ].filter(Boolean).join(' · ')}
              removeLabel={words.removeLabel(titleOf(d))}
              removeDialog={words.removeDialog}
            />
          ))}
        </ul>
      ) : (
        <EmptyState icon={<FileIcon size={22} />} title={words.none} className="mt-6">
          {words.delivered}
        </EmptyState>
      )}
    </Drawer>
  );
}
