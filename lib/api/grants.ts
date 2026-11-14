// Girovo API: who an app is for its grant, the grants and the Verlauf as the
// vault keeps them (docs/girovo-api.md, "Who is asking").
//
// A grant is bound to what the shell found out, never to what the app says:
//   - a signed app (MT-Media or a publisher Windows trusts): its publisher and
//     its executable's path, so an update by the same publisher keeps it;
//   - an unknown publisher: the path and the file's SHA-256, so any change to
//     the file asks again;
//   - through Girovo's own MCP helper (girovo-mcp, signed by MT-Media, with a
//     parent): the parent's identity, by the same two rules. A parent beside
//     any other client is ignored, Girovo's other MT-Media programs included:
//     only the helper may speak for another program.
//
// Pure and node-test-safe.

import {
  API_ERROR_CODES, API_PERMISSIONS, TRANSFER_STATES, isApiPermission,
  type ApiClient, type ApiGrant, type ApiLogEntry, type ApiPermission, type ApiProcess, type TransferState,
} from './types.ts';

/** How much the vault keeps (lib/vault.ts sanitizeVault applies them). */
export const API_LIMITS = {
  grants: 50,
  /** Verlauf: the newest of each app, and of all together. */
  logPerApp: 200,
  logTotal: 1000,
  name: 120,
  path: 1024,
  publisher: 200,
  method: 60,
} as const;

/** Girovo's MCP helper (src-tauri/mcp-helper) by its signature and its file, as the bundle names it: girovo-mcp(.exe). */
export const isMcpHelper = (p: ApiProcess): boolean =>
  p.publisher.kind === 'mtmedia' && /^girovo-mcp(\.exe)?$/i.test(fileName(p.exe));

/** The process a grant is about: the parent behind Girovo's MCP helper, else the client itself. */
export function grantSubject(client: ApiClient): { who: ApiProcess; viaMcp: boolean } {
  if (client.parent && isMcpHelper(client)) return { who: client.parent, viaMcp: true };
  return { who: client, viaMcp: false };
}

/**
 * A path as grants compare it: Windows paths (a drive letter, a UNC share or
 * a backslash) without regard to case and with one kind of slash, as Windows
 * itself treats them; any other path exactly as given (Linux is case-sensitive).
 */
export function normalPath(exe: string): string {
  const p = exe.trim();
  if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.includes('\\')) return p.replace(/\//g, '\\').toLowerCase();
  return p;
}

const hex = (s: string | undefined) => (s ?? '').trim().toLowerCase();

type Identity = { exe: string; publisher?: { kind: 'mtmedia' | 'verified'; name: string }; sha256?: string };

/** The identity a process is granted under: (publisher, path) when signed, (path, SHA-256) when not. */
export function identityOf(p: ApiProcess): Identity {
  const kind = p.publisher.kind;
  if (kind === 'mtmedia') return { exe: p.exe, publisher: { kind, name: 'MT-Media' } };
  if (kind === 'verified' && p.publisher.name?.trim()) return { exe: p.exe, publisher: { kind, name: p.publisher.name.trim() } };
  return { exe: p.exe, sha256: hex(p.sha256) };
}

/** One string per identity: what the Verlauf names an app by and what a grant is found by. */
export function grantKey(id: Identity): string {
  return id.publisher
    ? `signed|${id.publisher.kind}|${id.publisher.name}|${normalPath(id.exe)}`
    : `unknown|${normalPath(id.exe)}|${hex(id.sha256)}`;
}

/** The key of the identity a client is granted under. */
export const clientKey = (client: ApiClient): string => grantKey(identityOf(grantSubject(client).who));

/** The grant that covers this client, or null. */
export function findGrant(grants: readonly ApiGrant[], client: ApiClient): ApiGrant | null {
  const key = clientKey(client);
  return grants.find((g) => grantKey(g) === key) ?? null;
}

/** The permissions in API_PERMISSIONS' order, each once. */
export const orderedPermissions = (list: Iterable<ApiPermission>): ApiPermission[] => {
  const set = new Set(list);
  return API_PERMISSIONS.filter((p) => set.has(p));
};

/**
 * The grants with `client`'s allowed permissions added (a new grant when it
 * has none yet). The display name is the shell's for the subject; an update
 * refreshes it.
 */
export function withGrant(grants: readonly ApiGrant[], client: ApiClient, allowed: readonly ApiPermission[], now: string): ApiGrant[] {
  const { who, viaMcp } = grantSubject(client);
  const key = grantKey(identityOf(who));
  const current = grants.find((g) => grantKey(g) === key);
  const name = clip(who.name, API_LIMITS.name) || fileName(who.exe);
  if (current) {
    const next: ApiGrant = { ...current, name, permissions: orderedPermissions([...current.permissions, ...allowed]) };
    if (viaMcp) next.viaMcp = true;
    return grants.map((g) => (g === current ? next : g));
  }
  const grant: ApiGrant = { ...identityOf(who), name, permissions: orderedPermissions(allowed), at: now };
  if (viaMcp) grant.viaMcp = true;
  return [...grants, grant];
}

/** The grants with one app's permission switched on or off (Einstellungen → Girovo API). */
export function withPermission(grants: readonly ApiGrant[], key: string, permission: ApiPermission, on: boolean): ApiGrant[] {
  return grants.map((g) => {
    if (grantKey(g) !== key) return g;
    const rest = g.permissions.filter((p) => p !== permission);
    return { ...g, permissions: on ? orderedPermissions([...rest, permission]) : rest };
  });
}

/** The grants without one app (Zugriff entziehen). */
export const withoutGrant = (grants: readonly ApiGrant[], key: string): ApiGrant[] => grants.filter((g) => grantKey(g) !== key);

/** The grants with the app's last use stamped. */
export function touchedGrant(grants: readonly ApiGrant[], key: string, at: string): ApiGrant[] {
  return grants.map((g) => (grantKey(g) === key ? { ...g, used: at } : g));
}

// ---------------------------------------------------------------------------
// The vault's copy: sanitised on the way in and out (lib/vault.ts, the page's
// normalizeVault). Whatever a file holds, a grant is well formed or gone.
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const iso = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null);
const fileName = (exe: string) => exe.split(/[\\/]/).pop() || exe;

/** The grants as the vault may keep them: well formed, each identity once (the last wins), within the cap. */
export function sanitizeApiGrants(input: unknown): ApiGrant[] {
  if (!Array.isArray(input)) return [];
  const byKey = new Map<string, ApiGrant>();
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const exe = clip(raw.exe, API_LIMITS.path);
    const at = iso(raw.at);
    if (!exe || !at) continue;
    let ident: Identity;
    if (raw.publisher !== undefined) {
      const p = raw.publisher;
      if (!isRecord(p) || (p.kind !== 'mtmedia' && p.kind !== 'verified')) continue;
      const pname = p.kind === 'mtmedia' ? 'MT-Media' : clip(p.name, API_LIMITS.publisher);
      if (!pname) continue;
      ident = { exe, publisher: { kind: p.kind, name: pname } };
    } else {
      const sha = hex(typeof raw.sha256 === 'string' ? raw.sha256 : '');
      if (!/^[0-9a-f]{64}$/.test(sha)) continue;
      ident = { exe, sha256: sha };
    }
    const permissions = Array.isArray(raw.permissions) ? orderedPermissions(raw.permissions.filter(isApiPermission)) : [];
    const grant: ApiGrant = {
      ...ident,
      name: clip(raw.name, API_LIMITS.name) || fileName(exe),
      permissions,
      at,
      ...(raw.viaMcp === true ? { viaMcp: true as const } : {}),
      ...(iso(raw.used) ? { used: iso(raw.used)! } : {}),
    };
    const key = grantKey(grant);
    byKey.delete(key);
    byKey.set(key, grant);
  }
  return [...byKey.values()].slice(-API_LIMITS.grants);
}


/** The Verlauf as the vault may keep it: well formed, oldest first, within both caps. */
export function sanitizeApiLog(input: unknown): ApiLogEntry[] {
  if (!Array.isArray(input)) return [];
  const out: ApiLogEntry[] = [];
  for (const raw of input) {
    if (!isRecord(raw)) continue;
    const at = iso(raw.at);
    const app = clip(raw.app, API_LIMITS.path + API_LIMITS.publisher + 80);
    const method = clip(raw.method, API_LIMITS.method);
    if (!at || !app || !method || typeof raw.ok !== 'boolean') continue;
    const code = API_ERROR_CODES.find((c) => c === raw.code);
    const detail = clip(raw.detail, API_LIMITS.method);
    const request = clip(raw.request, API_LIMITS.method);
    const outcome = TRANSFER_STATES.find((st) => st === raw.outcome);
    out.push({
      at, app, name: clip(raw.name, API_LIMITS.name) || app, method, ok: raw.ok,
      ...(!raw.ok && code ? { code } : {}),
      ...(detail ? { detail } : {}),
      ...(request && outcome ? { request, outcome } : {}),
    });
  }
  return capLog(out);
}

/** The newest entries: at most API_LIMITS.logPerApp of one app, API_LIMITS.logTotal in all. Oldest first. */
export function capLog(log: readonly ApiLogEntry[]): ApiLogEntry[] {
  const seen = new Map<string, number>();
  const kept: ApiLogEntry[] = [];
  for (let i = log.length - 1; i >= 0 && kept.length < API_LIMITS.logTotal; i--) {
    const e = log[i];
    const n = seen.get(e.app) ?? 0;
    if (n >= API_LIMITS.logPerApp) continue;
    seen.set(e.app, n + 1);
    kept.push(e);
  }
  return kept.reverse();
}

/** The Verlauf with new entries added at its end, capped. */
export const appendLog = (log: readonly ApiLogEntry[], entries: readonly ApiLogEntry[]): ApiLogEntry[] =>
  entries.length ? capLog([...log, ...entries]) : [...log];

/** The Verlauf with a transfer request's line saying where it stands now (transfers.request, once the user acted). */
export function withLogOutcome(log: readonly ApiLogEntry[], request: string, outcome: TransferState): ApiLogEntry[] {
  let changed = false;
  const next = log.map((e) => {
    if (e.request !== request || e.outcome === outcome) return e;
    changed = true;
    return { ...e, outcome };
  });
  return changed ? next : [...log];
}
