'use client';

// The desktop updater as the page sees it (electron/updater.cjs behind
// window.electronUpdater): one subscription for the whole page, shared by
// every surface that mentions an update — the dialog, the Mitteilungen card,
// the Sitzung row, the login bar — so they can never disagree.
//
// Outside the desktop shell there is no bridge and `state` stays null; every
// update surface then renders nothing.

import { useSyncExternalStore } from 'react';

export type UpdateState = ElectronUpdateState;

type Snapshot = {
  state: UpdateState | null;
  /** The update dialog. */
  dialog: boolean;
  /** The release whose notice has been looked at in Mitteilungen — the bell stops counting it. */
  seen: string | null;
  /** The "aktualisiert" toast has been shown for this page. */
  greeted: boolean;
};

const INITIAL: Snapshot = { state: null, dialog: false, seen: null, greeted: false };

let snapshot: Snapshot = INITIAL;
const listeners = new Set<() => void>();
let attached = false;
let detach: (() => void) | null = null;

function commit(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronUpdater);

/** Every answer from the main process is the whole state; a null is a refusal and changes nothing. */
const take = (state: UpdateState | null | undefined) => {
  if (state && typeof state === 'object') commit({ state });
};

function attach() {
  const b = bridge();
  if (attached || !b) return;
  attached = true;
  try {
    detach = b.onState(take);
    b.getState().then((state) => {
      // A pushed state that arrived first is newer than this answer.
      if (!snapshot.state) take(state);
    }, () => {});
  } catch {
    /* no updater in this shell: the page goes on without one */
  }
}

function subscribe(listener: () => void) {
  attach();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUpdates(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => INITIAL);
}

const call = (run: (b: NonNullable<Window['electronUpdater']>) => Promise<UpdateState | null>) => {
  const b = bridge();
  if (!b) return Promise.resolve();
  return run(b).then(take, () => {});
};

export const updates = {
  openDialog: () => commit({ dialog: true }),
  closeDialog: () => commit({ dialog: false }),
  markSeen: () => {
    const version = snapshot.state?.release?.version ?? null;
    if (version && snapshot.seen !== version) commit({ seen: version });
  },
  markGreeted: () => commit({ greeted: true }),
  check: () => call((b) => b.check()),
  download: () => call((b) => b.download()),
  cancel: () => call((b) => b.cancel()),
  install: () => call((b) => b.install()),
  setAuto: (on: boolean) => call((b) => b.setAuto(on)),
  openRelease: () => call((b) => b.openRelease()),
};

/**
 * A newer version is known — whether or not it is downloaded yet. A check
 * running meanwhile keeps the release it found before (the main process
 * replaces it only with an answer), so the notice does not flicker.
 */
export function hasNewer(state: UpdateState | null): state is UpdateState & { release: NonNullable<UpdateState['release']> } {
  return !!state?.release && state.phase !== 'current' && state.phase !== 'idle';
}

/** The bell counts a newer version until its notice has been seen. */
export function unseenUpdate(snap: Snapshot): boolean {
  return hasNewer(snap.state) && snap.seen !== snap.state.release.version;
}

/**
 * For the design preview (app/design-preview/updater.ts) only: forget the
 * bridge this page attached to, so the fake one put in its place is picked
 * up by the next subscriber. Called while the preview renders a fresh tree,
 * so it tells no listener — the new tree reads the new snapshot anyway.
 */
export function resetUpdatesForPreview({ dialog = false }: { dialog?: boolean } = {}) {
  detach?.();
  detach = null;
  attached = false;
  snapshot = { ...INITIAL, dialog };
}
