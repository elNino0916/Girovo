// The public keys an update manifest may be signed with, by role
// (update-trust.ts; docs/update-channels.md). Their secret halves: the stable
// key and the two reserve keys in the owner's keys folder, password-protected;
// the nightly key in the Actions secret GIROVO_NIGHTLY_SIGNING_KEY; the next
// key in the owner's keys folder without a password, until Next builds start
// in CI. The desktop updater has the same keys in
// src-tauri/src/updater/trust.rs.
//
// Made with `node scripts/sign-update.mjs keygen`: key ids stable
// db00cdc657dd9421, nightly bc7687ce7912473c (2026-11-07), next
// 4783eb4473d8281e, reserve1 148e76a8a204a6e8, reserve2 02c48bf0ff17f160
// (2026-11-11) (the `key` a .sig names). An empty key would trust nothing.

import type { TrustedKeys } from './update-trust.ts';

export const TRUSTED_KEYS: TrustedKeys = {
  stable: 'hIxe7Pv8XxowIliZVYOGpjwtWsHKCWgi2LEIwbIZmrw=',
  nightly: 'HdD/wUqH5Grzgw94akcTP+nFREWm9XoD1k2C2s1AHTU=',
  next: 'zQJdGVv0+4TldBFYP01ytg3EQLTx2UFl8Gx3fGUKUys=',
  reserve1: 'YgrdSul6VVLATln2k+5j10m5g2Mub/TvluNFQN2b7qI=',
  reserve2: '6dIg96Dt62Zlcatu/sMZ/scsYqaewIksz04rTnhtFhs=',
};
