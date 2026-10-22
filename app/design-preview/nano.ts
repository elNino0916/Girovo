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
//   stuck         AICore offers it, takes "Jetzt laden" and never begins (a Xiaomi
//                 17 Ultra did so for hours): the row says so after a minute
//   unsupported · update · aicore   a phone without Nano, and why
//   old           Nano there, but v3: categories work, "Frag deine Umsätze" says it needs v4
//
// With Nano v4 there, "Frag deine Umsätze" on the Analyse gets Nano's line for a
// few words (Amazon, Rewe, Lebensmittel, größte, wie oft, pro Monat; "Unsinn"
// is not understood). The rest of the runtime is the quietest answer each
// part has (no fingerprint, no Play update, an integrity check that cannot tell).
//
// ?plus=free|active|inactive|unavailable is Girovo Plus as the Play build sees it.
//
// ?integrity=modified|unknown|kept gives the integrity check an answer instead
// (kept: a rooted phone the user lets keep its data anyway), for Gerätesicherheit's
// dialog, its 10-second "Schließen" and the warning it opens.

export const INTEGRITY_SCENARIOS = ['modified', 'unknown', 'kept'] as const;
export const PLUS_SCENARIOS = ['free', 'active', 'inactive', 'unavailable'] as const;
export const isPlusScenario = (s: string): s is PlusState => (PLUS_SCENARIOS as readonly string[]).includes(s);

/**
 * Girovo Plus without Play (?plus=…): Play's offers as a German phone shows
 * them; buying subscribes after a moment, as a licence tester's purchase does.
 */
function fakePlus(start: PlusState): GirovoMobile['plus'] {
  let status: PlusStatus = {
    state: start,
    plan: start === 'active' ? 'monthly' : null,
    offers: start === 'inactive' || start === 'active'
      ? [{ plan: 'monthly', price: '0,99 €', trialDays: 3 }, { plan: 'yearly', price: '9,99 €', trialDays: 3 }]
      : [],
    icon: 'standard',
  };
  const fns = new Set<(s: PlusStatus) => void>();
  const set = (s: PlusStatus) => { status = s; for (const fn of fns) fn(s); };
  return {
    status: async () => status,
    onChange: (fn) => { fns.add(fn); return () => fns.delete(fn); },
    buy: async (plan) => {
      setTimeout(() => set({ ...status, state: 'active', plan }), 700);
      return true;
    },
    manage: async () => { window.open('https://play.google.com/store/account/subscriptions', '_blank'); },
    setIcon: async (icon) => {
      if (icon === 'plus' && status.state !== 'active') return null;
      set({ ...status, icon });
      return status;
    },
    openGitHub: async () => { window.open('https://github.com/elNino0916/Girovo/releases/latest', '_blank'); },
  };
}
export type IntegrityScenario = (typeof INTEGRITY_SCENARIOS)[number];
export const isIntegrityScenario = (s: string): s is IntegrityScenario => (INTEGRITY_SCENARIOS as readonly string[]).includes(s);

import type { PlusState, PlusStatus } from '@/lib/plus';

export const NANO_SCENARIOS = ['available', 'working', 'waiting', 'downloading', 'downloadable', 'stuck', 'unsupported', 'update', 'aicore', 'old'] as const;
export type NanoScenario = (typeof NANO_SCENARIOS)[number];
export const isNanoScenario = (s: string): s is NanoScenario => (NANO_SCENARIOS as readonly string[]).includes(s);

const GB = 1_000_000_000;

export function installFakeNano(
  nanoScenario: NanoScenario | null,
  integrityScenario: IntegrityScenario | null = null,
  plusScenario: PlusState | null = null,
): void {
  if (!nanoScenario && !integrityScenario && !plusScenario) return;
  const scenario: NanoScenario = nanoScenario ?? 'available';
  let status: GirovoNanoStatus =
    scenario === 'unsupported' ? { state: 'unsupported', reason: 'unavailable' }
      : scenario === 'update' ? { state: 'unsupported', reason: 'update' }
        : scenario === 'aicore' ? { state: 'unsupported', reason: 'aicore' }
          : scenario === 'downloadable' || scenario === 'stuck' ? { state: 'downloadable' }
            : scenario === 'downloading' ? { state: 'downloading', received: 0, total: 1.2 * GB }
              : scenario === 'old' ? { state: 'available', model: 'nano-v3-fast', askModel: 'nano-v3-fast' }
                : { state: 'available', model: 'nano-v4-fast', askModel: 'nano-v4-fast' };
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
        setStatus({ state: 'available', model: 'nano-v4-fast', askModel: 'nano-v4-fast' });
      } else setStatus({ state: 'downloading', started: true, received, total });
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
      // Asked, and never begun: AICore's own callbacks never come.
      if (scenario === 'stuck') {
        setStatus({ state: 'downloading' });
        return new Promise<GirovoNanoStatus>(() => {});
      }
      setStatus({ state: 'downloading', started: true, received: 0, total: 1.2 * GB });
      fetchModel();
      return status;
    },
    progress: async () => progress,
    onProgress: (fn) => { progressFns.add(fn); return () => progressFns.delete(fn); },
  };

  const quiet = async () => {};
  // "Frag deine Umsätze": Nano's line for a few words, after a Nano-like pause.
  // Only the question's own line counts (after "Frage:"), not the examples.
  const ask: GirovoMobile['ask'] = async (_system, text) => {
    await new Promise((r) => setTimeout(r, 900));
    const q = text.slice(text.lastIndexOf('Frage:')).toLowerCase(); // i18n-data
    if (q.includes('unsinn') || q.includes('nonsense')) return 'Das weiß ich nicht.'; // i18n-data
    const kind = /größte|groesste|largest/.test(q) ? 'groesste' : /wie oft|how often/.test(q) ? 'anzahl'
      : /zuletzt|last time/.test(q) ? 'letzte' : /pro monat|per month|im schnitt/.test(q) ? 'durchschnitt' : 'summe'; // i18n-data
    const category = /lebensmittel|groceries/.test(q) ? 'groceries' : /essen gehen|eating out|restaurant/.test(q) ? 'leisure'
      : /tanken|fuel/.test(q) ? 'mobility' : null; // i18n-data
    const search = /amazon/.test(q) ? 'Amazon' : /rewe/.test(q) ? 'Rewe' : null;
    const dir = /bekommen|received|eingang/.test(q) ? 'ein' : 'aus'; // i18n-data
    return JSON.stringify({ art: kind, richtung: dir, kategorie: category, suche: search });
  };
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
    ask,
    openAICore: async () => { window.open('https://play.google.com/store/apps/details?id=com.google.android.aicore', '_blank'); },
    integrity: async () => (integrityScenario
      ? {
        device: integrityScenario === 'unknown' ? 'unknown' : 'modified', copy: 'official', level: 'tee', runtime: [],
        savingAllowed: integrityScenario === 'kept',
      }
      : null),
    plus: fakePlus(plusScenario ?? 'free'),
    // The phone restarts the app; here the address says what it starts with.
    chooseSaving: (verdict) => {
      const url = new URL(window.location.href);
      url.searchParams.set('integrity', verdict ? 'kept' : 'modified');
      window.location.assign(url);
    },
    playUpdate: async () => ({ available: false, start: async () => 'canceled' }),
    launch: { on: () => () => {}, readShared: async () => new File([], '') },
    haptic: () => {},
  } as GirovoMobile;
}
