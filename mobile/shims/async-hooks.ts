// `AsyncLocalStorage` for the phone server, where no async context exists.
//
// A browser cannot carry a value across an `await` (the TC39 AsyncContext
// proposal has not shipped), so a store set by run() is visible to the code
// that runs synchronously inside it — and gone after its first await. The
// three scopes the server keeps can live with that:
//
//  - lib/bank-fetch.ts marks a bank request from HttpClient.sendMessage, and
//    lib-fints calls fetch synchronously inside it (before any await), so the
//    mark is there when the fetch wrapper looks.
//  - lib/i18n/server.ts's request language: outside its scope msgs() falls
//    back to the page's language, which on the phone is the request's too.
//  - lib/telemetry.ts's context: a report may lose its BLZ, nothing more.
//
// The one store that has to outlive an await is the signal of a login the user
// may call off (withBankSignal). An instance can name such stores with
// `keepAcrossAwait`: while the promise run() returned is pending, getStore()
// outside any synchronous run answers the latest of them (mobile/server/boot.ts
// sets this for the bank scope).

export class AsyncLocalStorage<T> {
  private current: T | undefined;
  private readonly pending: T[] = [];
  /** Stores that stay visible until the run that set them settles. */
  keepAcrossAwait: ((store: T) => boolean) | null = null;

  getStore(): T | undefined {
    return this.current ?? this.pending[this.pending.length - 1];
  }

  run<R>(store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    const prev = this.current;
    this.current = store;
    let result: R;
    try {
      result = fn(...args);
    } finally {
      this.current = prev;
    }
    if (this.keepAcrossAwait?.(store) && result instanceof Promise) {
      this.pending.push(store);
      const drop = () => {
        const at = this.pending.lastIndexOf(store);
        if (at >= 0) this.pending.splice(at, 1);
      };
      result.then(drop, drop);
    }
    return result;
  }

  enterWith(store: T): void {
    this.current = store;
  }

  exit<R>(fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    return this.run(undefined as T, fn, ...args);
  }

  disable(): void {
    this.current = undefined;
    this.pending.length = 0;
  }
}

export default { AsyncLocalStorage };
