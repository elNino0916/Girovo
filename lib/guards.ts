// The shape check every sanitiser starts with (vault, history, backup, the
// sent orders, the splits, the linked banks): a plain object to read keys
// from — not null, not an array. Pure and node-test-safe.

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
