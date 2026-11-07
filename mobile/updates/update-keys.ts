// The public keys an update manifest must be signed with (update-trust.ts;
// docs/updater-v2.md). Their secret halves: the stable key in the owner's keys
// folder, password-protected; the nightly key in the Actions secret
// GIROVO_NIGHTLY_SIGNING_KEY. The desktop updater has the same two keys in
// src-tauri/src/updater/trust.rs.
//
// Made with `node scripts/sign-update.mjs keygen` on 2026-11-07: key ids
// stable db00cdc657dd9421, nightly bc7687ce7912473c (the `key` a .sig names).
// An empty key would trust nothing.

import type { TrustedKeys } from './update-trust.ts';

export const TRUSTED_KEYS: TrustedKeys = {
  stable: 'hIxe7Pv8XxowIliZVYOGpjwtWsHKCWgi2LEIwbIZmrw=',
  nightly: 'HdD/wUqH5Grzgw94akcTP+nFREWm9XoD1k2C2s1AHTU=',
};
