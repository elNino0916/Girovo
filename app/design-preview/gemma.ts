// A stand-in for the desktop's model (window.electronGemma) in the design
// preview: Einstellungen → Girovo AI in each of its states without the
// Tauri shell or a 3.4 GB download. ?gemma=<state> on any view. Laden counts
// up to ready in a few seconds, Abbrechen keeps what came, Löschen empties it.
// prompt() answers null, so asking falls back to the templates as it would
// with a model that does not answer.

export const GEMMA_STATES = ['absent', 'partial', 'downloading', 'ready', 'error'] as const;
export type GemmaPreviewState = (typeof GEMMA_STATES)[number];

export const isGemmaState = (s: string): s is GemmaPreviewState => (GEMMA_STATES as readonly string[]).includes(s);

const TOTAL = 3.35e9;

export function installFakeGemma(start: GemmaPreviewState | null) {
  if (typeof window === 'undefined') return;
  if (!start) {
    delete window.electronGemma;
    return;
  }
  const base: GirovoGemmaState = {
    state: 'absent', received: 0, total: TOTAL, partial: 0,
    unavailable: false, gpu: null, warm: false, starting: false, supported: true,
  };
  let now: GirovoGemmaState = {
    ...base,
    ...(start === 'partial' ? { partial: 1.2e9 } : {}),
    ...(start === 'downloading' ? { state: 'downloading' as const, phase: 'model' as const, received: 1.4e9 } : {}),
    ...(start === 'ready' ? { state: 'ready' as const } : {}),
    ...(start === 'error' ? { state: 'error' as const, error: 'Auf dem Laufwerk ist nicht genug Platz.', partial: 0.8e9 } : {}),
  };
  const listeners = new Set<(s: GirovoGemmaState) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const set = (next: GirovoGemmaState) => {
    now = next;
    for (const l of listeners) l(now);
    return Promise.resolve(now);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  window.electronGemma = {
    getState: async () => now,
    download: () => {
      if (now.state === 'ready' || now.state === 'downloading') return Promise.resolve(now);
      void set({ ...now, state: 'downloading', phase: 'model', received: now.partial, partial: 0, error: undefined });
      timer = setInterval(() => {
        const received = Math.min(TOTAL, now.received + TOTAL / 12);
        if (received >= TOTAL) {
          stop();
          void set({ ...base, state: 'ready' });
        } else void set({ ...now, received });
      }, 400);
      return Promise.resolve(now);
    },
    cancel: () => {
      stop();
      return set({ ...base, partial: now.received });
    },
    remove: () => {
      stop();
      return set({ ...base });
    },
    prompt: async () => null,
    onState: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
