// The Girovo API's page-side state rules (components/api/ApiHost.tsx and the
// login's notice), kept pure so they can be tested without React or a shell.
//
// Two things, kept apart since 2026-11-14: whether the API listens (the
// user's switch, which the shell remembers across starts, so the pipe is
// there before any login) and whether the page can answer (logged in, the
// vault open). A call that comes while the page can't is held by the shell,
// which brings Girovo forward; the login says who waits.

import { grantSubject } from './grants.ts';
import type { ApiClient, ApiProcess } from './types.ts';

/** The publisher as the dialog and the transfer sheet name it: MT-Media, a verified name, or null (unknown). */
export function publisherLabel(p: ApiProcess): string | null {
  if (p.publisher.kind === 'mtmedia') return 'MT-Media';
  if (p.publisher.kind === 'verified') return p.publisher.name?.trim() || null;
  return null;
}

/** What the login's notice says: the first app waiting, its publisher, and how many more. Null when nobody waits. */
export type WaitingNotice = { app: string; publisher: string | null; more: number };

/**
 * Who waits, as the login shows it: an assistant through Girovo MCP as the
 * assistant (as the dialog does), each app once, in the order they asked.
 */
export function waitingNotice(clients: readonly ApiClient[] | null | undefined): WaitingNotice | null {
  if (!clients?.length) return null;
  const seen = new Set<string>();
  const apps: ApiProcess[] = [];
  for (const client of clients) {
    const { who } = grantSubject(client);
    const key = `${who.exe}\u0000${who.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push(who);
  }
  const first = apps[0]!;
  return { app: first.name.trim() || first.exe, publisher: publisherLabel(first), more: apps.length - 1 };
}

/** The page can answer calls: logged in (this runs only on the dashboard) with the vault open. */
export const pageReadyFor = (vaultStatus: string): boolean => vaultStatus === 'ready';

/**
 * Builds before 2026-11-14 kept the switch in the vault only (vault.apiOn),
 * so the pipe could not be there before a login. Once the shell's own switch
 * is known: a vault that says on turns the shell's on, and the vault's flag
 * goes, so turning the API off later is not undone at the next login.
 */
export function vaultSwitchMove(vaultOn: boolean, shellOn: boolean | null): { turnOn: boolean; dropFromVault: boolean } {
  if (!vaultOn || shellOn === null) return { turnOn: false, dropFromVault: false };
  return { turnOn: !shellOn, dropFromVault: true };
}
