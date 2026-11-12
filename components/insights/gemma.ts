'use client';

// Girovo Next on the desktop: the shell's Gemma (src-tauri/src/gemma.rs,
// window.electronGemma). Absent in a browser, on Android and in older shells:
// then nothing here answers and the page asks as before (the built-in model
// reads the question, the templates say the answer).

import { useEffect, useState } from 'react';

export type GemmaState = GirovoGemmaState;

const bridge = () => (typeof window === 'undefined' ? undefined : window.electronGemma);

/** The shell's Gemma as it stands; null where there is none (a browser, Android, an older shell). */
export function useGemma(): GemmaState | null {
  const [state, setState] = useState<GemmaState | null>(null);
  useEffect(() => {
    const g = bridge();
    if (!g) return;
    let live = true;
    void g.getState().then((s) => live && setState(s)).catch(() => undefined);
    const off = g.onState((s) => live && setState(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/** Whether Gemma can answer now: loaded, and not given up on for this run (it would not start here). */
export const gemmaUsable = (s: GemmaState | null): boolean => s?.state === 'ready' && !s.unavailable;

/** Gemma's answer to one prompt, or null (not there, not ready, failed): the caller falls back. */
export async function gemmaPrompt(system: string, user: string, maxTokens: number, json = false): Promise<string | null> {
  const g = bridge();
  if (!g) return null;
  try {
    // json: the server holds Gemma to a JSON object (the planner, lib/ask-planner.ts).
    return await g.prompt(system, user, maxTokens, json);
  } catch {
    return null;
  }
}
