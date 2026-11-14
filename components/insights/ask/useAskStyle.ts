'use client';

// Girovo AI's answer style as the page uses it (lib/ask-style.ts): the saved
// choices from the vault, and the first name the bank gave for the account
// holder as the suggestion when none is typed (components/shell/session.ts).

import { useMemo } from 'react';
import { askStyle, type AskStyle } from '@/lib/ask-style';
import { useFints } from '../../FintsProvider';
import { firstName, sessionHolder } from '../../shell/session';

/** The first name the bank's holder name gives, or '' (a company account, none loaded). */
export function useSuggestedName(): string {
  const { accounts } = useFints();
  return useMemo(() => firstName(sessionHolder(accounts)), [accounts]);
}

export function useAskStyle(): AskStyle {
  const { vault } = useFints();
  const suggested = useSuggestedName();
  const { askTone, askLength, askName, askNameOff } = vault ?? {};
  return useMemo(
    () => askStyle({ askTone, askLength, askName, askNameOff }, suggested),
    [askTone, askLength, askName, askNameOff, suggested],
  );
}
