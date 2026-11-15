'use client';

// Girovo Next on the desktop: the user's own account groups, "Eigene"
// (lib/account-groups.ts), as the sidebar (AccountLayers.tsx) and "Konten
// anordnen" (ArrangeSheet.tsx, `flat`) read and change them. Every change
// goes into the vault at once (and from there to the other devices); the
// phone's layout never offers "Eigene" and goes on with accountGrouping.

import { useCallback, useMemo } from 'react';
import {
  REST_GROUP, addGroup, deleteGroup, groupsFromKinds, moveGroup, moveIntoGroup, ownGroupsOf, renameGroup, reorderGroup, toggleFolded,
  type OwnGroup, type ShownGroup,
} from '@/lib/account-groups';
import { groupKindOf, orderAccounts } from '@/lib/account-overview';
import type { VaultData } from '@/lib/app-types';
import type { SerializedAccount } from '@/lib/fints-types';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';

const keyOf = (a: SerializedAccount) => a.accountNumber;

/**
 * "Eigene" on: the groups kept, or the first time a copy of Nach Art (its
 * names in the language on screen then: from here on they are the user's),
 * its accounts in the order shown. Also what the Girovo API's
 * accountGrouping "own" sets (components/api/host-actions.tsx).
 */
export function withOwnGroupsOn(v: VaultData, accounts: readonly SerializedAccount[], names: Parameters<typeof groupsFromKinds>[1]['names']): VaultData {
  const groups = v.accountGroups ?? groupsFromKinds(orderAccounts(accounts, v.accountOrder), { kindOf: groupKindOf, keyOf, names });
  return { ...withGroups(v, groups), accountGroupsOn: true };
}

/** "Eigene" off; the groups stay kept for the next time. */
export function withOwnGroupsOff(v: VaultData): VaultData {
  if (!v.accountGroupsOn) return v;
  const rest = { ...v };
  delete rest.accountGroupsOn;
  return rest;
}

/** The vault with these groups; folds of groups that are gone go with them. */
function withGroups(v: VaultData, groups: OwnGroup[]): VaultData {
  const ids = new Set([REST_GROUP, ...groups.map((g) => g.id)]);
  const folded = (v.accountGroupsFolded ?? []).filter((id) => ids.has(id));
  const out: VaultData = { ...v, accountGroups: groups };
  if (folded.length) out.accountGroupsFolded = folded;
  else delete out.accountGroupsFolded;
  return out;
}

export function useOwnGroups() {
  const { accounts, vault, updateVault } = useFints();
  const t = useT();
  const on = !!vault?.accountGroupsOn;
  const stored = vault?.accountGroups;
  const ordered = useMemo(() => orderAccounts(accounts, vault?.accountOrder), [accounts, vault?.accountOrder]);
  /** The accounts on screen under the groups, "Weitere Konten" last. */
  const shown: ShownGroup<SerializedAccount>[] = useMemo(() => ownGroupsOf(ordered, stored ?? [], keyOf), [ordered, stored]);
  const folded = useMemo(() => new Set(vault?.accountGroupsFolded ?? []), [vault?.accountGroupsFolded]);
  const names = t.insights.accounts.groups;

  /** The name a shown group goes by: the user's, or "Weitere Konten". */
  const nameOf = useCallback((g: { name: string | null }) => g.name ?? names.other, [names]);

  const change = useCallback((fn: (groups: OwnGroup[]) => OwnGroup[]) => {
    updateVault((v) => withGroups(v, fn(v.accountGroups ?? [])));
  }, [updateVault]);

  /**
   * "Eigene" chosen, or left for no groups. The first time it starts with a
   * copy of Nach Art: its names (in the language on screen then: from here
   * on they are the user's), its accounts in the order shown.
   */
  const setOn = useCallback((next: boolean) => {
    updateVault((v) => (next ? withOwnGroupsOn(v, accounts, names) : withOwnGroupsOff(v)));
  }, [updateVault, accounts, names]);

  const toggle = useCallback((id: string) => {
    updateVault((v) => {
      const next = toggleFolded(v.accountGroupsFolded ?? [], id);
      const out = { ...v };
      if (next.length) out.accountGroupsFolded = next;
      else delete out.accountGroupsFolded;
      return out;
    });
  }, [updateVault]);

  /**
   * A new group at the end; false at the cap or without a name. Made from
   * the groups as they stand when the change applies (a sync round may have
   * brought others meanwhile), never from this render's.
   */
  const add = useCallback((name: string): boolean => {
    if (!addGroup(stored ?? [], name)) return false;
    change((g) => addGroup(g, name)?.groups ?? g);
    return true;
  }, [stored, change]);

  return {
    on,
    /** The groups as kept, for their count and order. */
    groups: stored ?? [],
    shown,
    folded,
    nameOf,
    setOn,
    toggle,
    add,
    rename: useCallback((id: string, name: string) => change((g) => renameGroup(g, id, name)), [change]),
    remove: useCallback((id: string) => change((g) => deleteGroup(g, id)), [change]),
    moveGroupTo: useCallback((id: string, to: number) => change((g) => moveGroup(g, id, to)), [change]),
    /** An account into a group (REST_GROUP: out of every group), before `before` there or at its end. */
    moveInto: useCallback((key: string, target: string, before: string | null = null) => change((g) => moveIntoGroup(g, key, target, before)), [change]),
    /** A group's accounts on screen in a new sequence. */
    reorder: useCallback((id: string, onScreen: string[]) => change((g) => reorderGroup(g, id, onScreen)), [change]),
  };
}
