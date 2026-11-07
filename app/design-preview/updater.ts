// A stand-in for the desktop updater (window.electronUpdater) in the design
// preview: every state of the update dialog and its notices, without the
// desktop shell, a release or a network. ?update=<scenario> on any view; the
// "Updates" views in the index set it for you. The buttons work: the
// download runs a few seconds of fake progress, the install stops at
// "Wird gestartet".

import { resetUpdatesForPreview } from '@/components/updates/store';

export const UPDATE_SCENARIOS = [
  'idle', 'checking', 'current', 'available', 'downloading', 'ready', 'installed', 'manual', 'error', 'preview', 'back',
] as const;
export type UpdateScenario = (typeof UPDATE_SCENARIOS)[number];

export const isUpdateScenario = (s: string): s is UpdateScenario => (UPDATE_SCENARIOS as readonly string[]).includes(s);

// The running version as the masthead shows it, and the one after it that
// the fake offers — so the two never contradict each other.
const CURRENT = process.env.NEXT_PUBLIC_APP_VERSION || '4.3.0';
const NEXT = (() => {
  const [major, minor] = CURRENT.split(/[.-]/).map(Number);
  return `${major || 0}.${(minor || 0) + 1}.0`;
})();
/** What the preview channel offers: the next major's first preview. */
const PREVIEW = `${(Number(CURRENT.split('.')[0]) || 0) + 1}.0.0-preview.1`;

const NOTES = [
  `# Girovo ${NEXT}`,
  '',
  'Updates kommen jetzt direkt in der App an – geprüft, bevor sie laufen.',
  '',
  '## Neu',
  '- **Updates in der App**: Die App sucht beim Start und alle sechs Stunden nach einer neuen Version. Heruntergeladen und installiert wird erst, wenn du es sagst.',
  '- Jede heruntergeladene Datei wird mit der SHA-256-Prüfsumme abgeglichen, die GitHub für die Version berechnet hat.',
  '- *Nach dem Update* zeigt die App einmal, was neu ist.',
  '',
  '## Behoben',
  '- Ein Update-Installer konnte sich beim Beenden der alten Version selbst mit beenden (`taskkill /T`).',
  '- Kartenzahlungen zeigen den echten Händler statt des Zahlungsdienstleisters.',
  '',
  `Alle Änderungen: [Vergleich auf GitHub](https://github.com/elNino0916/Girovo/compare/${CURRENT}...${NEXT})`,
].join('\r\n');

const RELEASE: NonNullable<ElectronUpdateState['release']> = {
  version: NEXT,
  name: NEXT,
  notes: NOTES,
  url: `https://github.com/elNino0916/Girovo/releases/tag/${NEXT}`,
  publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  size: 104_919_142,
  canInstall: true,
};

function initial(scenario: UpdateScenario): ElectronUpdateState {
  const base: ElectronUpdateState = {
    current: CURRENT,
    kind: 'nsis',
    auto: true,
    early: false,
    channel: 'stable',
    phase: 'idle',
    checkedAt: null,
    release: null,
    received: 0,
    total: 0,
    error: null,
    installed: null,
    failedInstall: null,
  };
  const checkedAt = Date.now() - 4 * 60_000;
  switch (scenario) {
    case 'idle':
      return base;
    case 'checking':
      return { ...base, phase: 'checking' };
    case 'current':
      return { ...base, phase: 'current', checkedAt };
    case 'available':
      return { ...base, phase: 'available', checkedAt, release: RELEASE };
    case 'downloading':
      return { ...base, phase: 'downloading', checkedAt, release: RELEASE, received: 47_300_000, total: RELEASE.size! };
    case 'ready':
      return { ...base, phase: 'ready', checkedAt, release: RELEASE };
    case 'installed':
      return {
        ...base,
        current: NEXT,
        phase: 'current',
        checkedAt,
        installed: { version: NEXT, from: CURRENT, notes: NOTES, url: RELEASE.url },
      };
    case 'manual':
      return { ...base, kind: 'manual', phase: 'available', checkedAt, release: { ...RELEASE, canInstall: false } };
    case 'error':
      return {
        ...base,
        phase: 'available',
        checkedAt,
        release: RELEASE,
        error: { during: 'download', message: 'Die Verbindung zu GitHub ist abgebrochen. Versuche es noch einmal.' },
      };
    case 'preview':
      return { ...base, channel: 'preview', phase: 'available', checkedAt, release: previewRelease() };
    case 'back':
      // A preview installed, back on "Stabil": the older stable release as the way back.
      return { ...base, current: PREVIEW, phase: 'available', checkedAt, release: backRelease() };
  }
}

function backRelease(): NonNullable<ElectronUpdateState['release']> {
  return { ...RELEASE, version: CURRENT, name: CURRENT, url: `https://github.com/elNino0916/Girovo/releases/tag/${CURRENT}`, back: true };
}

function previewRelease(): NonNullable<ElectronUpdateState['release']> {
  return { ...RELEASE, version: PREVIEW, name: PREVIEW, url: `https://github.com/elNino0916/Girovo/releases/tag/${PREVIEW}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Puts a fake updater on window for this view (null: none — the web app).
 * `kind`: whose updater it is, the installed Windows app's unless said.
 */
export function installFakeUpdater(
  scenario: UpdateScenario | null,
  { dialog = false, kind }: { dialog?: boolean; kind?: ElectronUpdateState['kind'] } = {},
) {
  resetUpdatesForPreview({ dialog });
  // Opened in the desktop app itself, the preload's real updater is there and
  // can be neither removed nor replaced (contextBridge): the preview keeps it.
  if (Object.getOwnPropertyDescriptor(window, 'electronUpdater')?.configurable === false) return;
  if (!scenario) {
    delete window.electronUpdater;
    return;
  }
  let state = kind ? { ...initial(scenario), kind } : initial(scenario);
  const listeners = new Set<(s: ElectronUpdateState) => void>();
  const set = (patch: Partial<ElectronUpdateState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
    return state;
  };
  let progress: ReturnType<typeof setInterval> | null = null;

  window.electronUpdater = {
    getState: async () => state,
    check: async () => {
      set({ phase: 'checking', error: null });
      await sleep(900);
      return scenario === 'current' || scenario === 'idle' || scenario === 'checking'
        ? set({ phase: 'current', checkedAt: Date.now() })
        : set({ phase: 'available', checkedAt: Date.now(), release: state.release ?? RELEASE });
    },
    download: async () => {
      if (state.phase !== 'available' || !state.release) return state;
      const total = state.release.size ?? 0;
      set({ phase: 'downloading', received: 0, total, error: null });
      progress = setInterval(() => {
        const received = Math.min(total, state.received + total / 24);
        if (received >= total) {
          if (progress) clearInterval(progress);
          set({ phase: 'ready', received: total });
        } else {
          set({ received });
        }
      }, 150);
      return state;
    },
    cancel: async () => {
      if (progress) clearInterval(progress);
      return set({ phase: 'available', received: 0, total: 0 });
    },
    install: async () => set({ phase: 'installing' }),
    // The installed Windows app: the start window would install it after the restart.
    restartToUpdate: async () => {
      console.info('[design-preview] would restart into the start window to install', state.release?.version);
      return state;
    },
    setAuto: async (on) => set({ auto: on }),
    setEarly: async (on) => set({ early: on }),
    // A picked file: checked for a moment, then an older signed release.
    chooseFile: async () => {
      set({ file: { phase: 'checking', name: 'Girovo-6.0.1-Setup.exe', version: null, older: false, same: false, message: null } });
      await sleep(900);
      return set({ file: { phase: 'ready', name: 'Girovo-6.0.1-Setup.exe', version: '6.0.1', older: true, same: false, message: null } });
    },
    installFile: async () => set({ file: null, phase: 'installing' }),
    dismissFile: async () => set({ file: null }),
    // As the real one: the other channel's offer goes, a check in the new one follows.
    setChannel: async (channel) => {
      if (progress) clearInterval(progress);
      set({ channel, phase: 'checking', release: null, received: 0, total: 0, error: null });
      await sleep(900);
      return channel === 'preview'
        ? set({ phase: 'available', checkedAt: Date.now(), release: previewRelease() })
        // Back on stable from a preview: the stable release, older as it is.
        : state.current.includes('-')
          ? set({ phase: 'available', checkedAt: Date.now(), release: backRelease() })
          : set({ phase: 'current', checkedAt: Date.now() });
    },
    openRelease: async () => {
      console.info('[design-preview] would open', state.release?.url ?? state.installed?.url);
      return state;
    },
    onState: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
