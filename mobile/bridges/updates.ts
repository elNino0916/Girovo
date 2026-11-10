// Updates of the Android app from GitHub (the "github" flavour), behind the
// same bridge the desktop's updater gives the page — window.electronUpdater,
// types/electron-window.d.ts — so the update dialog, the Mitteilungen card
// and the Sitzung row (components/updates) work unchanged.
//
// Where an update comes from and why it can be trusted (docs/updater-v2.md,
// ../updates/update-trust.ts): girovo.de lists each channel's newest release
// as its signed girovo-update.json; only one signed with Girovo's key (the
// nightly key too on the Nightly channel) counts, ordered by build number.
// When girovo.de can't be asked, GitHub's API as before — and there too only
// a release whose signed manifest checks out. The APK is downloaded natively
// and kept only when its size and SHA-256 are what the signed manifest says
// (GirovoUpdater); Android's installer then checks that it is signed like the
// installed app. Which file is ours: ../updates/update-logic.cjs (the
// release's "-android.apk"). On the
// preview channel (Einstellungen → Update-Kanal) the list of releases is
// read instead of the latest one, pre-releases included — Android installs
// no older version over a newer one, so going back to stable waits for the
// next stable release above the installed preview.
//
// The Google Play build has no such bridge: Play brings its updates, and the
// Sitzung panel offers Play's own in-app update (components/android). Nor has
// the F-Droid build: its repository serves stable releases only.

import logic from '../updates/update-logic.cjs';
import { MANIFEST_BASE, MANIFEST_NAME, SIG_NAME, buildNumber, parseListing, pickListed, releaseOf, signerFits, verifyManifest, type UpdateRelease } from '../updates/update-trust.ts';
import { TRUSTED_KEYS } from '../updates/update-keys.ts';
import { msgs } from '../../lib/i18n/index.ts';
import { GirovoDevice, GirovoUpdater, type UpdaterState } from '../native';
import { reportError, track } from './telemetry';

const AUTO_PREF = 'fints.autoUpdate';
/** 'stable' (unset) or 'preview': whether pre-releases are offered too. */
const CHANNEL_PREF = 'fints.updateChannel';
/** The release that took this install from the Nightly channel back to Stabil (logic.movesToStable), or the one a channel was picked on: set, never again. */
const MOVED_PREF = 'fints.updateChannel.movedToStable';
const LAST_VERSION_PREF = 'fints.lastVersion';
/** The release an install was started for: { version, notes, url } — what the next start greets. */
const INSTALLING_PREF = 'fints.installing';
/** 'on': "Neueste Updates sofort erhalten" — a staged release reaches this phone at once. */
const EARLY_PREF = 'fints.updates.early';
/** A random id of this installation, only for its rollout bucket (update-trust.ts bucket). */
const INSTALL_ID_PREF = 'fints.updates.installId';
/**
 * What girovo.de offered this copy last, per channel: { stable?: { build, at }, preview?: … }.
 * While girovo.de can't be asked, GitHub offers nothing above it (logic.offersFromGitHub).
 */
const LISTED_PREF = 'fints.updates.listed';
const EVERY_MS = 6 * 60 * 60 * 1000;

type Release = UpdateRelease;

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
/** Counts the checks: an answer that a newer check (another channel's) overtook is dropped. */
let checks = 0;
/** Where the updater stood when the running check began: 'checking' hides it (logic.phaseAfterCheck). */
let beforeCheck: { phase: ElectronUpdateState['phase']; version: string | null } = { phase: 'idle', version: null };
/** The version whose download the plugin was last asked for; null once the channel changed or Android refused it (logic.aboutOffer). */
let asked: string | null = null;
/** Releases the plugin refused as older than the installed app: not offered again in this session. */
const refused = new Set<string>();
const listeners = new Set<(s: ElectronUpdateState) => void>();

function set(patch: Partial<ElectronUpdateState>): ElectronUpdateState {
  const before = state;
  state = { ...state, ...patch };
  report(before, state);
  for (const fn of listeners) fn(state);
  return state;
}

/** The updater's moves as telemetry, as the Electron desktop shell reported them. */
function report(before: ElectronUpdateState | undefined, now: ElectronUpdateState): void {
  if (!before) return;
  if (now.release && now.phase === 'available' && before.release?.version !== now.release.version) {
    track('update_available', { version: now.release.version });
  }
  if (now.release && now.phase === 'ready' && before.phase === 'downloading') {
    track('update_downloaded', { version: now.release.version });
  }
  if (now.error && now.error !== before.error && now.error.during !== 'check') {
    reportError({ name: 'UpdateError', message: now.error.message }, { source: 'updater', during: now.error.during });
  }
}

function installId(): string {
  const known = read(INSTALL_ID_PREF);
  if (known) return known;
  const id = crypto.randomUUID().replaceAll('-', '');
  write(INSTALL_ID_PREF, id);
  return id;
}

/** girovo.de's offer: a release, null for none, undefined when girovo.de couldn't be asked. */
async function fromGirovoDe(preview: boolean): Promise<Release | null | undefined> {
  try {
    const res = await fetch(`${MANIFEST_BASE}${preview ? 'nightly' : 'stable'}.json?kind=apk`);
    if (!res.ok) return undefined;
    const listing = parseListing(await res.json());
    if (!listing) return undefined;
    const offer = pickListed(listing, preview ? 'nightly' : 'stable', TRUSTED_KEYS, installId(), state.early === true);
    // Every good answer is remembered, an empty one too: the release it offered
    // this copy, else the running version (logic.listedBuild).
    const build = logic.listedBuild(offer ? buildNumber(offer.version) : null, buildNumber(state.current));
    write(LISTED_PREF, logic.rememberListed(read(LISTED_PREF), preview ? 'preview' : 'stable', build, Date.now()));
    return offer;
  } catch {
    return undefined;
  }
}

/** GitHub's offer as its signed manifest describes it; null without one that checks out. */
async function signedCopy(release: Release, preview: boolean): Promise<Release | null> {
  const file = (name: string) => release.assets.find((a) => a.name === name);
  const manifest = file(MANIFEST_NAME);
  const sig = file(SIG_NAME);
  if (!manifest || !sig) return null;
  try {
    const [text, sigText] = await Promise.all([manifest, sig].map(async (a) => {
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }));
    const signer = verifyManifest(new TextEncoder().encode(text), sigText, TRUSTED_KEYS);
    const copy = signerFits(signer, preview ? 'nightly' : 'stable') ? releaseOf(text) : null;
    return copy && copy.version === release.version ? copy : null;
  } catch {
    return null;
  }
}

/** GitHub's API as before: the latest release, on the preview channel the newest with an APK. */
async function fromGitHub(preview: boolean): Promise<Release | null> {
  const url = preview ? logic.listUrl(logic.FEED_URL)! : logic.FEED_URL;
  const ask = () => fetch(url, { headers: { accept: 'application/vnd.github+json' } });
  let res = await ask();
  // As the desktop's updater: GitHub's passing failure is asked once more after a breath.
  if (logic.passingFailure(res.status)) {
    await new Promise((resolve) => setTimeout(resolve, logic.RETRY_DELAY_MS));
    res = await ask();
  }
  if (res.status === 403 || res.status === 429) {
    // The quota is per connection: say when it comes back, where GitHub said.
    const h = (name: string) => res.headers.get(name);
    const wait = logic.rateLimitWait(h('retry-after'), h('x-ratelimit-remaining'), h('x-ratelimit-reset'), Math.floor(Date.now() / 1000));
    throw new Error(msgs().android.updates.rateLimited(wait));
  }
  if (!res.ok) throw new Error(msgs().android.updates.httpError(res.status));
  const json: unknown = await res.json();
  // On the preview channel only a release with an APK: the nightly previews are the desktop's alone.
  const release: Release | null = preview ? logic.newestRelease(json, state.current, { kind: 'android' }) : logic.parseRelease(json);
  return release && signedCopy(release, preview);
}

/** Whether `candidate` comes after the installed version: by build number, which knows every name a release ever had. */
function isNewer(candidate: string, preview: boolean): boolean {
  const a = buildNumber(candidate);
  const b = buildNumber(state.current);
  return a != null && b != null ? a > b : logic.isNewer(candidate, state.current, { prerelease: preview });
}

async function check(): Promise<ElectronUpdateState> {
  if (state.phase === 'downloading' || state.phase === 'installing') return state;
  const run = ++checks;
  const preview = state.channel === 'preview';
  // A check that overtakes a running one starts from where that one did.
  if (state.phase !== 'checking') beforeCheck = { phase: state.phase, version: state.release?.version ?? null };
  const before = beforeCheck;
  set({ phase: 'checking', error: null });
  try {
    const listed = await fromGirovoDe(preview);
    const found = listed === undefined ? await fromGitHub(preview) : listed;
    if (run !== checks) return state;
    const release = found && !refused.has(found.version) && isNewer(found.version, preview) ? found : null;
    // girovo.de couldn't be asked, and GitHub knows no halt and no rollout:
    // its release counts only up to what girovo.de offered this copy last.
    if (release && listed === undefined) {
      const remembered = logic.listedFor(read(LISTED_PREF), preview ? 'preview' : 'stable');
      if (!logic.offersFromGitHub(buildNumber(release.version), remembered, Date.now())) {
        // Nothing new for now, and no error: an offer on screen stays, its downloaded file with it.
        const phase = logic.phaseAfterHeldCheck(before);
        if (phase !== 'current') return set({ phase, checkedAt: Date.now() });
        latest = null;
        return set({ phase, release: null, checkedAt: Date.now() });
      }
    }
    if (!release) {
      latest = null;
      return set({ phase: 'current', release: null, checkedAt: Date.now() });
    }
    latest = release;
    const apk = logic.pickAsset(release, 'android');
    return set({
      // The APK already downloaded for this release is still the one to install.
      phase: logic.phaseAfterCheck(before, release.version),
      checkedAt: Date.now(),
      release: {
        version: release.version,
        name: release.name,
        notes: release.notes,
        url: release.url,
        publishedAt: release.publishedAt,
        size: apk?.size ?? null,
        // Only a file with a signed hash can be checked before it is installed.
        canInstall: !!apk?.sha256,
      },
    });
  } catch (err) {
    if (run !== checks) return state;
    // The offer from before the check stays: its release is still shown.
    return set({ phase: logic.phaseAfterFailedCheck(before), error: { during: 'check', message: err instanceof Error ? err.message : String(err) } });
  }
}

/** Switches the channel and asks again at once: the other channel's offer, even a downloaded one, is dropped. */
async function setChannel(value: UpdateChannel): Promise<ElectronUpdateState> {
  const channel = logic.channelOf(value);
  write(CHANNEL_PREF, channel);
  // Picked by hand: no later start takes it back to Stabil (logic.movesToStable).
  write(MOVED_PREF, logic.pickedMarker(state.current));
  if (channel === state.channel) return state;
  // The other channel's offer goes, on offer, downloading, downloaded or at
  // Android's installer: a check running for it is overtaken, the one that
  // follows starts from nothing (a failed one must not go back to "ready"),
  // the plugin drops the file, and nothing it still says about it counts.
  checks++;
  asked = null;
  latest = null;
  beforeCheck = logic.afterChannelChange();
  set({ channel, phase: 'idle', release: null, received: 0, total: 0 });
  await GirovoUpdater.cancel().catch(() => {});
  return check();
}

/** Android's version for an API level, as the phone's settings name it. */
const ANDROID_VERSION: Record<number, string> = { 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16', 37: '17' };

/** A failed download's reason in words: a release for a newer Android says which, one Android would refuse as older says so (UpdaterPlugin). */
function downloadError(error: string | undefined): string {
  if (error === 'older-version') return msgs().android.updates.olderVersion;
  const needs = /^needs-sdk:(\d+)$/.exec(error ?? '');
  if (!needs) return error ?? '';
  const sdk = Number(needs[1]);
  return msgs().android.updates.needsAndroid(ANDROID_VERSION[sdk] ?? `API ${sdk}`);
}

function fromNative(s: UpdaterState): void {
  // Only about the release on offer: the file of another channel's release,
  // or of one Android refused, is never "ready" for this one.
  if (!logic.aboutOffer(asked, state.release?.version ?? null)) return;
  if (s.phase === 'downloading') set({ phase: 'downloading', received: s.received, total: s.total, error: null });
  else if (s.phase === 'ready') set({ phase: 'ready', received: s.total, total: s.total });
  else if (s.phase === 'failed' && s.error === 'older-version') {
    // Android would refuse it every time: the reason is said once, and the
    // release is not offered again in this session (check).
    if (asked) refused.add(asked);
    asked = null;
    latest = null;
    set({ phase: 'idle', release: null, received: 0, total: 0, error: { during: 'download', message: downloadError(s.error) } });
  } else if (s.phase === 'failed') set({ phase: 'available', error: { during: 'download', message: downloadError(s.error) } });
  // A download cancelled — or, back from Android's installer, the file gone: on offer again.
  else if (s.phase === 'idle' && (state.phase === 'downloading' || state.phase === 'installing')) set({ phase: 'available', received: 0 });
}

async function download(): Promise<ElectronUpdateState> {
  const apk = latest && logic.pickAsset(latest, 'android');
  if (!latest || !apk?.sha256) return state;
  asked = latest.version;
  set({ phase: 'downloading', received: 0, total: apk.size, error: null });
  try {
    fromNative(await GirovoUpdater.download({ url: apk.url, sha256: apk.sha256, size: apk.size }));
  } catch (err) {
    // Refused before it began: back to the offer, with the reason — never a
    // download that stays at 0 MB.
    set({ phase: 'available', received: 0, error: { during: 'download', message: err instanceof Error ? err.message : String(err) } });
  }
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
    if (pending && pending.version === current) installed = { version: current, from: last ?? '', notes: pending.notes, url: pending.url };
    else if (pending) failedInstall = pending.version;
  } catch { /* nothing pending */ }
  if (!installed && last && last !== current && logic.isNewer(current, last, { prerelease: true })) {
    installed = { version: current, from: last, notes: '', url: `${logic.RELEASES_PAGE}/tag/${current}` };
  }
  write(INSTALLING_PREF, null);
  write(LAST_VERSION_PREF, current);
  // A release build takes an install on the Nightly channel back to Stabil, once.
  if (logic.movesToStable(read(CHANNEL_PREF), current, read(MOVED_PREF))) {
    write(CHANNEL_PREF, 'stable');
    write(MOVED_PREF, current);
  } else if (logic.marksPicked(read(CHANNEL_PREF), current, read(MOVED_PREF))) {
    // Nightly chosen before a pick wrote the marker: the next release build leaves it there.
    write(MOVED_PREF, logic.pickedMarker(current));
  }

  state = {
    current,
    kind: 'android',
    auto: read(AUTO_PREF) !== 'off',
    early: read(EARLY_PREF) === 'on',
    channel: logic.channelOf(read(CHANNEL_PREF)),
    phase: 'idle',
    checkedAt: null,
    release: null,
    received: 0,
    total: 0,
    error: null,
    failedInstall,
    installed,
  };

  if (installed) track('update_installed', { from: installed.from, to: installed.version });

  void GirovoUpdater.addListener('state', fromNative);
  // Android's installer opened and was dismissed: the APK is still there to
  // install. The plugin says so when the app is back in front ('ready',
  // fromNative) — the installer's question need not hide the page; this is
  // for when it did.
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
    setEarly: async (on) => {
      write(EARLY_PREF, on ? 'on' : 'off');
      return set({ early: on });
    },
    setChannel,
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
