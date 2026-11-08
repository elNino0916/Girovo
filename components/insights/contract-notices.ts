'use client';

// What Mitteilungen says about contracts today, and which of it is new
// (lib/contract-watch.ts): the cancellation reminders in their window, the
// price rises of the last weeks. The bell's dot and the drawer read the same,
// on the one detection useRecurringModel shares.

import { useMemo } from 'react';
import { useFints } from '../FintsProvider';
import { contractNotices, unseenNotices, type ContractNotice } from '@/lib/contract-watch';
import { dayKey } from '@/lib/format';
import { msgs } from '@/lib/i18n';
import { seriesTitle, type RecurringSeries } from '@/lib/recurring';
import { useRecurringModel } from './recurring-model';

const nameOf = (s: RecurringSeries) => seriesTitle(s) || msgs().insights.noName;

export function useContractNotices(): { notices: ContractNotice[]; unseen: ContractNotice[] } {
  const model = useRecurringModel();
  const { vault } = useFints();
  const reminders = vault?.contractReminders;
  const noticed = vault?.noticedContracts;
  const today = dayKey(new Date());
  return useMemo(() => {
    const notices = contractNotices([...model.income, ...model.expense], reminders, today, nameOf);
    return { notices, unseen: unseenNotices(notices, noticed) };
  }, [model.income, model.expense, reminders, noticed, today]);
}
