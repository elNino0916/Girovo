'use client';

// Girovo AI's conversations kept in the vault (VaultData.askConversations,
// lib/ask-saved.ts), sealed with the PIN like everything else there.
//
// After the login (and when Girovo AI is switched on again) the vault's
// conversations come back into the thread's store; from then on every change
// there is written back through updateVault, which saves to disk a moment
// after the last change. Finished turns only: a question still being read is
// written once it is answered. Deleting a conversation, or all of them,
// removes them from the vault too. Switched off, nothing is written and
// nothing deleted: the store is forgotten in memory (AskThread.tsx AskReader),
// the vault keeps what it had.

import { useEffect, useRef } from 'react';
import type { SavedConversation } from '@/lib/ask-saved';
import type { VaultData } from '@/lib/app-types';
import { dayKey } from '@/lib/format';
import { useFints } from '../../FintsProvider';
import { isRestored, restoreConversations, savedConversations, useAskThread } from '../ask-thread-store';

/** The vault with `list` as its conversations; the key gone with the last one. */
function withConversations(v: VaultData, list: SavedConversation[]): VaultData {
  if (list.length) return { ...v, askConversations: list };
  if (!v.askConversations) return v;
  const { askConversations: _gone, ...rest } = v;
  return rest as VaultData;
}

export function useKeptConversations(): void {
  const s = useAskThread();
  const { vault, vaultStatus, updateVault } = useFints();
  const kept = vault?.askConversations;
  const off = !!vault?.askOff;
  // A vault to read and write: loaded (or, unreadable or unreachable, the session's own in memory).
  const ready = !!vault && vaultStatus !== 'idle' && vaultStatus !== 'loading';
  const active = ready && !off;
  /** What this hook last wrote: a vault holding anything else was replaced (a backup restored) and is read again. */
  const wrote = useRef<SavedConversation[] | undefined>(undefined);
  const wasActive = useRef(false);

  useEffect(() => {
    // Brought back as the vault arrives or Girovo AI is switched on. Never
    // after the store was forgotten under a vault still shown (the logout's
    // last render): that vault belongs to the session that just ended.
    const arriving = active && !wasActive.current;
    wasActive.current = active;
    if (!active) return;
    if (!arriving && (!isRestored() || kept === wrote.current)) return;
    restoreConversations(kept ?? [], dayKey(new Date()));
    wrote.current = kept;
  }, [active, kept]);

  useEffect(() => {
    if (!active || !isRestored()) return;
    // The store as it is now, not as this render saw it: a restore just above changed it already.
    const next = savedConversations();
    if (JSON.stringify(next) === JSON.stringify(kept ?? [])) {
      wrote.current = kept;
      return;
    }
    wrote.current = next.length ? next : undefined;
    updateVault((v) => withConversations(v, next));
  }, [s, active, kept, updateVault]);
}
