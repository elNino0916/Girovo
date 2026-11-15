'use client';

// The transfers apps asked for (transfers.request, lib/api/transfers.ts),
// between the router and Girovo's own transfer sheet: waiting their turn,
// one sheet at a time (a sheet already open is never replaced: its draft or
// its approval would be lost), and their end reported back once the user
// acted. components/api/ApiHost.tsx opens the next one and registers where
// the end goes; components/TransferSheet.tsx reports it.

import { useSyncExternalStore } from 'react';
import type { TransferAsk } from '@/lib/api/transfers';
import type { TransferState } from '@/lib/api/types';

/** What the sheet says about whom the request is from: the shell's name for the app, never the app's own claim. */
export type RequestLabel = { id: string; app: string; publisher: string | null };

export type QueuedTransfer = { label: RequestLabel; ask: TransferAsk };

export type TransferEnd = { state: Exclude<TransferState, 'pending'>; text?: string; changed?: boolean };

let queue: readonly QueuedTransfer[] = [];
/** The request whose sheet is open: it reports its own end when the sheet closes. */
let openId: string | null = null;
const listeners = new Set<() => void>();
let onEnd: ((id: string, end: TransferEnd) => void) | null = null;

function set(next: readonly QueuedTransfer[]) {
  queue = next;
  for (const l of listeners) l();
}

/** A request waits for its sheet. */
export function queueTransfer(item: QueuedTransfer): void {
  set([...queue, item]);
}

/** The next request, taken out of the queue (ApiHost opens its sheet). */
export function takeTransfer(): QueuedTransfer | null {
  const [first, ...rest] = queue;
  if (!first) return null;
  set(rest);
  openId = first.label.id;
  return first;
}

/** Every waiting request, taken out (the logout, the API switched off). */
export function dropTransfers(): QueuedTransfer[] {
  const all = [...queue];
  if (all.length) set([]);
  return all;
}

/** Where the ends go: the router's settleTransfer, while the API is live. */
export function onTransferEnd(fn: ((id: string, end: TransferEnd) => void) | null): void {
  onEnd = fn;
}

/** The sheet reports how a request ended (once; the router keeps the first). */
export function endTransfer(id: string, end: TransferEnd): void {
  if (openId === id) openId = null;
  onEnd?.(id, end);
}

/** The request whose sheet is open, if any (the logout leaves it to the sheet). */
export function openTransferId(): string | null {
  return openId;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** How many requests wait for their sheet. */
export function useQueuedTransfers(): number {
  return useSyncExternalStore(subscribe, () => queue.length, () => 0);
}
