// What has to reach the vault before a logout closes it: FintsProvider's
// logout runs these first, while the vault still takes changes, and saves
// after. components/api/ApiHost.tsx ends Girovo API's waiting requests and
// writes its grants and Verlauf this way; after the logout they would be lost.

const hooks = new Set<() => void>();

/** Runs fn right before each logout; returns how to stop. */
export function onBeforeLogout(fn: () => void): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

/** Every hook once; one that throws does not stop the logout. */
export function runBeforeLogout(): void {
  for (const fn of [...hooks]) {
    try {
      fn();
    } catch {
      // the logout goes on
    }
  }
}
