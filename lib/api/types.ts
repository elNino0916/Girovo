// Girovo API (docs/girovo-api.md): the shapes the page and the shell share,
// and what the vault keeps of it.
//
// The shell (src-tauri/src/api/) owns the pipe or socket, finds out who is at
// the other end (process, executable, its SHA-256, its code signature) and
// sends each call to the page as `api:call`; the page answers with
// `reply(id, { result } | { error })`. Nothing an app says about itself is
// trusted for who it is: `client` comes from the shell, never from the call.
//
// Pure types: no imports, so the node tests and the bridge's declaration
// (types/electron-window.d.ts) can both use them.

/** What the shell read from the executable's code signature. */
export type ApiPublisher = {
  /**
   * mtmedia: signed with Girovo's pinned MT-Media certificate, always trusted.
   * verified: Windows trusts the chain. unknown: unsigned, invalid, revoked,
   * untrusted, and every program on Linux.
   */
  kind: 'mtmedia' | 'verified' | 'unknown';
  /** The signer's organisation, else its common name; absent for unknown. */
  name?: string;
  thumbprint?: string;
};

/** One process at the other end of a connection, as the shell identified it. */
export type ApiProcess = {
  pid: number;
  /** The executable's full path. */
  exe: string;
  /** The executable's SHA-256, hex. */
  sha256: string;
  /** The signature's program name, else the file's description, else its file name. */
  name: string;
  publisher: ApiPublisher;
};

/**
 * The client of a connection. `parent`: the process that started Girovo's
 * own MCP helper (girovo-mcp, signed by MT-Media), identified the same way;
 * the grant and the dialog are the parent's.
 */
export type ApiClient = ApiProcess & { parent?: ApiProcess };

/** `api:call` as the shell emits it. */
export type ApiCall = {
  id: string | number;
  connection: string | number;
  client: ApiClient;
  method: string;
  /** null when the request had none. */
  params?: unknown;
};

/** `api:closed`: the app hung up (or the shell dropped it). */
export type ApiClosed = { connection: string | number };

/**
 * The page's error codes; the shell maps each to a JSON-RPC number and passes
 * the code itself as error.data.reason (an object `data` sits beside it).
 */
export const API_ERROR_CODES = [
  'locked', 'denied', 'not_permitted', 'invalid', 'refused_by_user', 'bank_error', 'method_not_found', 'internal', 'timeout',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiError = { code: ApiErrorCode; message: string; data?: unknown };

/** What the page hands back to the shell for one call. */
export type ApiReplyPayload = { result: unknown } | { error: ApiError };

/** The permissions an app can ask for (docs/girovo-api.md, Permissions). */
export const API_PERMISSIONS = [
  'accounts.read',
  'transactions.read',
  'insights.read',
  'ask',
  'categories.write',
  'notes.write',
  'budgets.write',
  'settings.read',
  'settings.write',
  'bank.refresh',
  'transfers.request',
] as const;

export type ApiPermission = (typeof API_PERMISSIONS)[number];

export const isApiPermission = (v: unknown): v is ApiPermission =>
  typeof v === 'string' && (API_PERMISSIONS as readonly string[]).includes(v);

/**
 * An app the user allowed, as the vault keeps it: this device's own, never
 * synced. A signed app (MT-Media or a verified publisher) is known by its
 * publisher and the executable's path, so an update by the same publisher
 * keeps the grant; an unknown publisher's by the path and the file's SHA-256,
 * so any change to the file asks again.
 */
export type ApiGrant = {
  /** The executable's path as the shell gave it. */
  exe: string;
  /** Signed apps: who signed it. Absent: an unknown publisher. */
  publisher?: { kind: 'mtmedia' | 'verified'; name: string };
  /** Unknown publisher only: the file's SHA-256 when it was allowed. */
  sha256?: string;
  /** The name shown when it was allowed (the shell's, never the app's own claim). */
  name: string;
  /** Allowed through Girovo's MCP helper (the dialog said "über Girovo MCP"). */
  viaMcp?: true;
  permissions: ApiPermission[];
  /** ISO, when it was first allowed. */
  at: string;
  /** ISO, its last call. */
  used?: string;
};

/** One call in the Verlauf: what, when, allowed or not. This device's own, never synced. */
export type ApiLogEntry = {
  /** ISO */
  at: string;
  /** The app's grant key (lib/api/grants.ts grantKey of its identity). */
  app: string;
  /** Its name at the time, so a revoked app's calls still say whose they were. */
  name: string;
  /** The method without "girovo.", e.g. "accounts.list". */
  method: string;
  /** Answered with a result. */
  ok: boolean;
  /** The error's code when not. */
  code?: ApiErrorCode;
};
