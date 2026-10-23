// Girovo Plus for the page (lib/plus.ts, docs/plus-plan.md): the Play build
// asks Play Billing through PlusPlugin; the GitHub build's plugin answers
// "free". A phone without Google Play billing reads 'unavailable', and the
// Plus screen points to the GitHub version, which has everything.

import { readStatus, type PlusIcon, type PlusPlan, type PlusStatus } from '../../lib/plus.ts';
import { GirovoDevice, GirovoPlus } from '../native';

/** Where a phone without Play billing gets Girovo with everything open. */
const GITHUB_RELEASES = 'https://github.com/elNino0916/Girovo/releases/latest';

/** Whether this is the Google Play build — the one Plus applies to. Asked once. */
let play: Promise<boolean> | null = null;
const playBuild = (): Promise<boolean> => (play ??= GirovoDevice.info().then((i) => i.flavor === 'play', () => false));

export async function status(): Promise<PlusStatus> {
  const onPlay = await playBuild();
  try {
    return readStatus(await GirovoPlus.status(), onPlay);
  } catch {
    return readStatus(null, onPlay);
  }
}

export function onChange(fn: (s: PlusStatus) => void): () => void {
  const handle = GirovoPlus.addListener('change', (raw) => void playBuild().then((onPlay) => fn(readStatus(raw, onPlay))));
  return () => void handle.then((h) => h.remove());
}

export async function buy(plan: PlusPlan): Promise<boolean> {
  return GirovoPlus.buy({ plan }).then((r) => r.launched, () => false);
}

export async function manage(): Promise<void> {
  await GirovoPlus.manage().catch(() => {});
}

export async function setIcon(icon: PlusIcon): Promise<PlusStatus | null> {
  const onPlay = await playBuild();
  return GirovoPlus.setIcon({ icon }).then((raw) => readStatus(raw, onPlay), () => null);
}

/** This installation's ID and whether an owner key opens Plus here; null where there is none (the GitHub build). */
export async function ownerInfo(): Promise<{ installId: string; owner: boolean } | null> {
  return GirovoPlus.owner().then(
    (r) => (typeof r?.installId === 'string' ? { installId: r.installId, owner: r.owner === true } : null),
    () => null,
  );
}

/** The status with the owner key in place, or null when the key is not this installation's. */
export async function setOwnerKey(key: string): Promise<PlusStatus | null> {
  const onPlay = await playBuild();
  return GirovoPlus.setOwnerKey({ key }).then((raw) => readStatus(raw, onPlay), () => null);
}

export async function clearOwnerKey(): Promise<PlusStatus | null> {
  const onPlay = await playBuild();
  return GirovoPlus.clearOwnerKey().then((raw) => readStatus(raw, onPlay), () => null);
}

export async function openGitHub(): Promise<void> {
  await GirovoDevice.openExternal({ url: GITHUB_RELEASES }).catch(() => {});
}
