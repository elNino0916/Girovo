// A limit on how long something may take to answer: for a step a person is
// waiting on behind a dialog that cannot be closed meanwhile. It stops the
// wait, not the work: what was asked for may still finish later.
//
// Pure and node-test-safe: no path aliases.

/** Thrown by withinTime when the time was up before an answer came. */
export class TimeLimitError extends Error {
  constructor() {
    super('No answer in time');
    this.name = 'TimeLimitError';
  }
}

/** `task`'s own result or error, or TimeLimitError once `ms` have gone by without one. */
export function withinTime<T>(task: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeLimitError()), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
