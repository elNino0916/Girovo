// The public keys an update manifest must be signed with (update-trust.ts;
// docs/updater-v2.md). Their secret halves: the stable key in the owner's keys
// folder, password-protected; the nightly key in the Actions secret
// GIROVO_NIGHTLY_SIGNING_KEY. The desktop updater has the same two keys in
// src-tauri/src/updater/trust.rs.
//
// Made with `node scripts/sign-update.mjs keygen`. Empty until then: an empty
// key trusts nothing, so a manifest can't be accepted by mistake.

import type { TrustedKeys } from './update-trust.ts';

export const TRUSTED_KEYS: TrustedKeys = {
  stable: '',
  nightly: '',
};
