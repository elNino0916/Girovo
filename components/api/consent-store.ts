'use client';

// The Girovo API's waiting consent requests (lib/api/router.ts asks through
// ApiHost): one dialog at a time, the others queued in the order they came.
// A request ends when the user answers, or when its signal says the app hung
// up or two minutes passed; it then leaves the queue unanswered.

import { useSyncExternalStore } from 'react';
import type { ConsentAnswer, ConsentRequest } from '@/lib/api/router';
import { bringForward } from './bridge';

type Waiting = { request: ConsentRequest; answer: (a: ConsentAnswer) => void };

let queue: readonly Waiting[] = [];
const listeners = new Set<() => void>();

function set(next: readonly Waiting[]) {
  const arrived = next.length > queue.length;
  queue = next;
  for (const l of listeners) l();
  // A new request brings the window to the front (the shell's focus, phase 2);
  // the taskbar button flashes while one waits and stops once none does.
  if (typeof window === 'undefined') return;
  if (arrived) bringForward();
  if (!arrived || !window.electronGirovoApi?.focus) window.electronWindow?.requestAttention(next.length > 0);
}

/** Queues a request; settles with the user's answer. An aborted signal takes it out unanswered. */
export function askConsent(request: ConsentRequest, signal: AbortSignal): Promise<ConsentAnswer> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const entry: Waiting = {
      request,
      answer: (a) => {
        set(queue.filter((w) => w !== entry));
        resolve(a);
      },
    };
    signal.addEventListener('abort', () => {
      if (!queue.includes(entry)) return;
      set(queue.filter((w) => w !== entry));
      reject(new Error('aborted'));
    }, { once: true });
    set([...queue, entry]);
  });
}

/** Every waiting request goes, unanswered (the API switched off, the logout). */
export function dropConsents(): void {
  if (queue.length) set([]);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The request the dialog shows now, or null. */
export function useCurrentConsent(): Waiting | null {
  return useSyncExternalStore(subscribe, () => queue[0] ?? null, () => null);
}
