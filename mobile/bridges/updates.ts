// Updates of the Android app from GitHub (the "github" flavour), behind the
// same bridge the desktop's updater gives the page — window.electronUpdater,
// types/electron-window.d.ts — so the update dialog, the Mitteilungen card
// and the Sitzung row (components/updates) work unchanged.
//
// Which release is newer and which of its files is ours is decided by the
// desktop's own, tested rules (electron/update-logic.cjs: the release's
// "-android.apk"). The APK is downloaded natively and kept only when its size
// and SHA-256 are what GitHub published for it (GirovoUpdater); Android's
// installer then checks that it is signed like the installed app.
//
// The Google Play build has no such bridge: Play brings its updates, and the
// Sitzung panel offers Play's own in-app update (components/android).

import logic from '../../electron/update-logic.cjs';
import { msgs } from '../../lib/i18n/index.ts';
import { GirovoDevice, GirovoUpdater, type UpdaterState } from '../native';

const AUTO_PREF = 'fints.autoUpdate';
const LAST_VERSION_PREF = 'fints.lastVersion';
/** The release an install was started for: { version, notes, url } — what the next start greets. */
const INSTALLING_PREF = 'fints.installing';
const EVERY_MS = 6 * 60 * 60 * 1000;

type Release = { version: string; name: string; notes: string; url: string; publishedAt: string | null; assets: { name: string; url: string; size: number; sha256: string | null }[] };

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* kept for this run */ }
};

let state: ElectronUpdateState;
let latest: Release | null = null;
const listeners = new Set<(s: ElectronUpdateState) => void>();

function set(patch: Partial<ElectronUpdateState>): ElectronUpdateState {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
  return state;
}

async function check(): Promise<ElectronUpdateState> {
  if (state.phase === 'downloading' || state.phase === 'installing') return state;
  set({ phase: 'checking', error: null });
  try {
    const res = await fetch(logic.FEED_URL, { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
    const release: Release | null = logic.parseRelease(await res.json());
    if (!release || !logic.isNewer(release.version, state.current)) {
      latest = null;
      return set({ phase: 'current', release: null, checkedAt: Date.now() });
    }
    latest = release;
    const apk = logic.pickAsset(release, 'android');
    return set({
      phase: state.phase === 'ready' && state.release?.version === release.version ? 'ready' : 'available',
      checkedAt: Date.now(),
      release: {
        version: release.version,
        name: release.name,
        notes: release.notes,
        url: release.url,
        publishedAt: release.publishedAt,
        size: apk?.size ?? null,
        // Only a file GitHub published a digest for can be checked before it is installed.
        canInstall: !!apk?.sha256,
      },
    });
  } catch (err) {
    return set({ phase: 'idle', error: { during: 'check', message: err instanceof Error ? err.message : String(err) } });
  }
}

function fromNative(s: UpdaterState): void {
  if (s.phase === 'downloading') set({ phase: 'downloading', received: s.received, total: s.total, error: null });
  else if (s.phase === 'ready') set({ phase: 'ready', received: s.total, total: s.total });
  else if (s.phase === 'failed') set({ phase: 'available', error: { during: 'download', message: s.error ?? '' } });
  else if (s.phase === 'idle' && state.phase === 'downloading') set({ phase: 'available', received: 0 });
}

async function download(): Promise<ElectronUpdateState> {
  const apk = latest && logic.pickAsset(latest, 'android');
  if (!apk?.sha256) return state;
  set({ phase: 'downloading', received: 0, total: apk.size, error: null });
  fromNative(await GirovoUpdater.download({ url: apk.url, sha256: apk.sha256, size: apk.size }));
  return state;
}

async function install(): Promise<ElectronUpdateState> {
  if (state.phase !== 'ready' || !state.release) return state;
  write(INSTALLING_PREF, JSON.stringify({ version: state.release.version, notes: state.release.notes, url: state.release.url }));
  try {
    const { result } = await GirovoUpdater.install();
    if (result === 'permission') {
      write(INSTALLING_PREF, null);
      return set({ error: { during: 'install', message: msgs().android.updates.permission } });
    }
    return set({ phase: 'installing', error: null });
  } catch (err) {
    write(INSTALLING_PREF, null);
    return set({ error: { during: 'install', message: err instanceof Error ? err.message : String(err) } });
  }
}

async function cancel(): Promise<ElectronUpdateState> {
  await GirovoUpdater.cancel().catch(() => {});
  return set({ phase: latest ? 'available' : 'idle', received: 0 });
}

async function openRelease(): Promise<ElectronUpdateState> {
  await GirovoDevice.openExternal({ url: state.release?.url ?? logic.RELEASES_PAGE }).catch(() => {});
  return state;
}

/** Sets the bridge up for the GitHub build. Resolves once the running version is known. */
export async function installUpdates(): Promise<void> {
  const info = await GirovoDevice.info().catch(() => null);
  if (!info || info.flavor !== 'github') return;

  // What this start is: the first after an update, or one after an install that did not happen.
  const current = info.versionName;
  const last = read(LAST_VERSION_PREF);
  let installed: ElectronUpdateState['installed'] = null;
  let failedInstall: string | null = null;
  try {
    const pending = JSON.parse(read(INSTALLING_PREF) ?? 'null') as { version: string; notes: string; url: string } | null;
    if (pending && pending.version === current) installed = { version: current, from: last ?? '', notes: pending.notes, url: pending.url, previousFile: null };
    else if (pending) failedInstall = pending.version;
  } catch { /* nothing pending */ }
  if (!installed && last && last !== current && logic.isNewer(current, last)) {
    installed = { version: current, from: last, notes: '', url: `${logic.RELEASES_PAGE}/tag/${current}`, previousFile: null };
  }
  write(INSTALLING_PREF, null);
  write(LAST_VERSION_PREF, current);

  state = {
    current,
    kind: 'android',
    auto: read(AUTO_PREF) !== 'off',
    phase: 'idle',
    checkedAt: null,
    release: null,
    received: 0,
    total: 0,
    location: null,
    error: null,
    failedInstall,
    installed,
  };

  void GirovoUpdater.addListener('state', fromNative);
  // Android's installer opened and was dismissed: the APK is still there to install.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.phase === 'installing') set({ phase: 'ready' });
  });

  window.electronUpdater = {
    getState: async () => state,
    check,
    download,
    cancel,
    install,
    setAuto: async (on) => {
      write(AUTO_PREF, on ? 'on' : 'off');
      return set({ auto: on });
    },
    openRelease,
    onState: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // As on the desktop: at start (once the login has had its moment), then every six hours.
  const auto = () => {
    if (state.auto) void check();
  };
  setTimeout(auto, 15_000);
  setInterval(auto, EVERY_MS);
}

/** Google Play's in-app update (the "play" flavour): whether Play has a newer version, and its flow. */
export async function playUpdate(): Promise<{ available: boolean; start: () => Promise<'started' | 'canceled' | 'failed'> }> {
  const info = await GirovoDevice.info().catch(() => null);
  if (!info || info.flavor !== 'play') return { available: false, start: async () => 'failed' };
  const { available } = await GirovoUpdater.playCheck().catch(() => ({ available: false }));
  return { available, start: async () => (await GirovoUpdater.playUpdate().catch(() => ({ result: 'failed' as const }))).result };
}
