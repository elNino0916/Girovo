// `process` for the phone server: the environment electron/main.cjs hands the
// desktop server, as constants, and the folders mobile/shims/fs.ts lays out.

const env: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  NEXT_RUNTIME: 'nodejs',
  FINTS_STATE_DIR: '/data/fints-state',
  GIROVO_MODEL_DIR: '/model',
};

export const process = {
  env,
  platform: 'android',
  arch: 'arm64',
  version: 'v22.0.0',
  versions: {} as Record<string, string>,
  argv: [] as string[],
  cwd: () => '/app',
  nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  on: () => process,
  off: () => process,
  once: () => process,
  emitWarning: (warning: unknown) => console.warn(warning),
  stdout: { write: (_chunk: unknown) => true },
  stderr: { write: (chunk: unknown) => (console.error(String(chunk)), true) },
};

export function setImmediate(fn: (...args: unknown[]) => void, ...args: unknown[]): ReturnType<typeof setTimeout> {
  return setTimeout(fn, 0, ...args);
}

export function clearImmediate(handle: ReturnType<typeof setTimeout>): void {
  clearTimeout(handle);
}
