// A stand-in for the phone runtime's category guess (window.girovoMobile,
// mobile/bridges/categories.ts) in the design preview, so Einstellungen'
// "Kategorien mit Gemini Nano" row and the progress line under Umsätze and on
// Analyse can be seen without a phone. Android preview only
// (npm run android:preview); ?nano=<scenario> on any view:
//
//   available     Nano is there, nothing to do
//   working       a batch of 240 bookings, AICore busy every 14th for 2 s
//   waiting       AICore keeps it waiting — the wait gets named after 5 s
//   downloading   AICore fetching the model, with its progress
//   downloadable  AICore offers it; "Jetzt laden" starts the fake download
//   unsupported · update · aicore   a phone without Nano, and why
//
// The rest of the runtime is the quietest answer each part has (no
// fingerprint, no Play update, an integrity check that cannot tell).

export const NANO_SCENARIOS = ['available', 'working', 'waiting', 'downloading', 'downloadable', 'unsupported', 'update', 'aicore'] as const;
export type NanoScenario = (typeof NANO_SCENARIOS)[number];
export const isNanoScenario = (s: string): s is NanoScenario => (NANO_SCENARIOS as readonly string[]).includes(s);

const GB = 1_000_000_000;

export function installFakeNano(scenario: NanoScenario | null): void {
  if (!scenario) return;
  let status: GirovoNanoStatus =
    scenario === 'unsupported' ? { state: 'unsupported', reason: 'unavailable' }
      : scenario === 'update' ? { state: 'unsupported', reason: 'update' }
        : scenario === 'aicore' ? { state: 'unsupported', reason: 'aicore' }
          : scenario === 'downloadable' ? { state: 'downloadable' }
            : scenario === 'downloading' ? { state: 'downloading', received: 0, total: 1.2 * GB }
              : { state: 'available', model: 'nano-v4-fast' };
  let progress: GirovoNanoProgress = { active: false, done: 0, total: 0, waiting: null };
  const statusFns = new Set<(s: GirovoNanoStatus) => void>();
  const progressFns = new Set<(p: GirovoNanoProgress) => void>();
  const setStatus = (s: GirovoNanoStatus) => { status = s; for (const fn of statusFns) fn(s); };
  const setProgress = (p: GirovoNanoProgress) => { progress = p; for (const fn of progressFns) fn(p); };

  const fetchModel = () => {
    const total = 1.2 * GB;
    let received = status.received ?? 0;
    const timer = setInterval(() => {
      received = Math.min(total, received + total / 40);
      if (received >= total) {
        clearInterval(timer);
        setStatus({ state: 'available', model: 'nano-v4-fast' });
      } else setStatus({ state: 'downloading', received, total });
    }, 250);
  };
  if (scenario === 'downloading') fetchModel();

  if (scenario === 'working' || scenario === 'waiting') {
    const total = 240;
    let done = 0;
    let pause = 0;
    setProgress({ active: true, done, total, waiting: null });
    setInterval(() => {
      if (scenario === 'waiting' && done >= 30) {
        if (progress.waiting !== 'busy') setProgress({ ...progress, waiting: 'busy' });
        return;
      }
      if (pause > 0) {
        pause -= 1;
        if (pause === 0) setProgress({ ...progress, waiting: null });
        return;
      }
      done += 1;
      if (done % 14 === 0) {
        pause = 8;
        setProgress({ active: true, done, total, waiting: 'busy' });
        return;
      }
      if (done >= total) done = 0;
      setProgress({ active: true, done, total, waiting: null });
    }, 240);
  }

  const categories: GirovoMobile['categories'] = {
    status: async () => status,
    onStatus: (fn) => { statusFns.add(fn); return () => statusFns.delete(fn); },
    download: async () => {
      setStatus({ state: 'downloading', received: 0, total: 1.2 * GB });
      fetchModel();
      return status;
    },
    progress: async () => progress,
    onProgress: (fn) => { progressFns.add(fn); return () => progressFns.delete(fn); },
  };

  const quiet = async () => {};
  window.girovoMobile = {
    ...window.girovoMobile,
    ready: Promise.resolve(),
    biometric: {
      state: async () => ({ available: false, reason: 'none-enrolled' }),
      enrolled: async () => false,
      enroll: async () => 'canceled',
      unlock: async () => ({ result: 'missing' }),
      forget: quiet,
    },
    categories,
    integrity: async () => null,
    playUpdate: async () => ({ available: false, start: async () => 'canceled' }),
    launch: { on: () => () => {}, readShared: async () => new File([], '') },
    haptic: () => {},
  } as GirovoMobile;
}
