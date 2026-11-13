'use client';

// Girovo Next on the desktop, "Namen mit Girovo AI aufräumen": the cleaned
// names the lists show, and the background work that asks Gemma for them.
//
// Called once, in the provider (components/FintsProvider.tsx), which hands the
// names to components/transactions/model.ts setAiNames: txText shows them in
// place of the bank's, the path Gemini Nano's brands take on Android, so the
// lists, the search, rankings and Girovo AI's answers read the same name. A
// booking's details keep the bank's own text ("Name laut Bank").
//
// On (vault.aiNamesOn, the model downloaded): every counterparty of the loaded
// bookings not cleaned yet is asked, one at a time, so a question to Girovo AI
// waits for one name at most; new bookings are asked as they load. Answers go
// to the vault in small batches (lib/ai-names-store.ts). Off: no names, at
// once; what was cleaned stays for the next time. Never on Android.

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { CLEAN_PROMPT_VERSION, CLEAN_SHOTS, CLEAN_SYSTEM, cleanText, parseCleanAnswer } from '@/lib/ai-names';
import { aiNameKey, aiNamesMap, namesToClean, withCleanedNames, type AiNameSource } from '@/lib/ai-names-store';
import type { VaultData } from '@/lib/app-types';
import type { SerializedTransaction } from '@/lib/fints-types';
import { IS_ANDROID } from '@/lib/platform';
import { gemmaPrompt, gemmaUsable, useGemma } from '../gemma';

/** Names cleaned in this round and how many it has: the settings row's line. Null while nothing is asked. */
export type AiNamesProgress = { done: number; total: number } | null;

let progress: AiNamesProgress = null;
const listeners = new Set<() => void>();

function setProgress(next: AiNamesProgress): void {
  if (next === progress || (next && progress && next.done === progress.done && next.total === progress.total)) return;
  progress = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** How far the cleaning is, for Einstellungen (components/insights/ai/AiNamesSetting.tsx). */
export function useAiNamesProgress(): AiNamesProgress {
  return useSyncExternalStore(subscribe, () => progress, () => null);
}

/** Answers written to the vault together: fewer saves, the lists redrawn every few names. */
const BATCH = 20;
/** As scripts/eval-gemma-bookings.mjs asks: a name is a few tokens. */
const MAX_TOKENS = 20;
/** Gemma gave nothing this many times in a row: it is not answering now, the rest waits for the next round. */
const FAILURES = 3;

type Lists = {
  vault: VaultData | null;
  updateVault: (fn: (v: VaultData) => VaultData) => void;
  txByAccount: Record<string, readonly SerializedTransaction[]>;
  pending: Record<string, { txs: readonly SerializedTransaction[] }>;
  noted: Record<string, { txs: readonly SerializedTransaction[] }>;
};

/** The cleaned names by aiNameKey while switched on, null while off (or on Android). */
export function useAiNames({ vault, updateVault, txByAccount, pending, noted }: Lists): ReadonlyMap<string, string> | null {
  const gemma = useGemma();
  // As components/insights/ask-gate.ts useModelReady says it on the desktop: the model is on the disk.
  const on = !IS_ANDROID && !!vault?.aiNamesOn && !!gemma?.supported && gemma.state === 'ready';
  // Asking needs more: not given up on in this run.
  const usable = on && gemmaUsable(gemma);
  const cache = vault?.aiNames;
  const names = useMemo(() => (on ? aiNamesMap(cache, CLEAN_PROMPT_VERSION) : null), [on, cache]);

  const txs = useMemo(
    () => (usable
      ? [
          ...Object.values(txByAccount).flat(),
          ...Object.values(pending).flatMap((p) => p.txs),
          ...Object.values(noted).flatMap((p) => p.txs),
        ]
      : []),
    [usable, txByAccount, pending, noted],
  );

  const updateRef = useRef(updateVault);
  updateRef.current = updateVault;
  const usableRef = useRef(usable);
  usableRef.current = usable;
  /** Names waiting to be asked, by key. */
  const queue = useRef(new Map<string, AiNameSource>());
  /** Names asked in this session, answered or not: never twice. */
  const asked = useRef(new Set<string>());
  /** The loaded bookings' keys: the cap drops other names first. */
  const keep = useRef<ReadonlySet<string>>(new Set());
  /** Raised to end the loop under way (switched off, signed out). */
  const round = useRef(0);
  const running = useRef(false);
  const counts = useRef({ done: 0, total: 0 });

  // One loop at a time, one name at a time.
  const loopRef = useRef<(gen: number) => Promise<void>>(async () => undefined);
  loopRef.current = async (gen: number) => {
    running.current = true;
    const found: [string, string][] = [];
    const flush = () => {
      if (!found.length) return;
      const batch = found.splice(0);
      const keepNow = keep.current;
      updateRef.current((v) => (v.aiNamesOn
        ? { ...v, aiNames: withCleanedNames(v.aiNames, CLEAN_PROMPT_VERSION, batch, keepNow) }
        : v));
    };
    let failures = 0;
    try {
      setProgress({ ...counts.current });
      while (gen === round.current) {
        const next = queue.current.values().next();
        if (next.done) break;
        const src = next.value;
        queue.current.delete(src.key);
        asked.current.add(src.key);
        const answer = await gemmaPrompt(CLEAN_SYSTEM, CLEAN_SHOTS + cleanText(src.name, src.shop), MAX_TOKENS);
        counts.current.done++;
        if (answer === null) {
          if (++failures >= FAILURES) break;
        } else {
          failures = 0;
          // '' where the check refused the answer: the bank's name stays, and it is not asked again.
          found.push([src.key, parseCleanAnswer(answer, src.name, src.shop) ?? '']);
          if (found.length >= BATCH) flush();
        }
        if (gen === round.current) setProgress({ ...counts.current });
      }
    } finally {
      flush();
      running.current = false;
      if (gen === round.current) {
        // Done, or Gemma stopped answering: what is left comes with the next round.
        queue.current.clear();
        counts.current = { done: 0, total: 0 };
        setProgress(null);
      } else if (queue.current.size && usableRef.current) {
        // Switched off and on again while a name was out: go on with the new round.
        void loopRef.current(round.current);
      }
    }
  };

  useEffect(() => {
    if (!usable) {
      round.current++;
      queue.current.clear();
      asked.current.clear();
      counts.current = { done: 0, total: 0 };
      setProgress(null);
      return;
    }
    keep.current = new Set(txs.map(aiNameKey).filter(Boolean));
    for (const src of namesToClean(txs, cache, CLEAN_PROMPT_VERSION, asked.current)) {
      if (queue.current.has(src.key)) continue;
      queue.current.set(src.key, src);
      counts.current.total++;
    }
    if (queue.current.size && !running.current) void loopRef.current(round.current);
  }, [usable, txs, cache]);

  // The provider gone (a reload): the loop ends with its current name.
  useEffect(() => () => {
    round.current++;
    setProgress(null);
  }, []);

  return names;
}
