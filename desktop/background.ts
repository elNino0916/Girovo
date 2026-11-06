// "Neue Umsätze melden" on the Tauri desktop: the shell keeps time and the
// notification area (src-tauri/src/background.rs) and asks for a check
// ("background:run"); the check runs here, in the route handler the Electron
// shell asked over HTTP (app/api/background, op "check"), and its result goes
// back (background_result) for the shell to show the notices. The secret is
// the shell's, the one the further banks' PINs are sealed with
// (window.electronLinkedUnlock).
//
// It runs whether the window is shown or hidden in the notification area: the
// page stays loaded behind a hidden window, and its timers are not throttled
// (src-tauri/src/shell.rs BROWSER_ARGS).

import { shell } from './shell';

type LinkedUnlock = { secret: () => Promise<string | null> };

async function check(): Promise<unknown | null> {
  const unlock = (window as Window & { electronLinkedUnlock?: LinkedUnlock }).electronLinkedUnlock;
  const secret = await unlock?.secret().catch(() => null);
  if (!secret) return null;
  const res = await fetch('/api/background', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'check', secret }),
  });
  return res.ok ? res.json() : null;
}

export function startBackgroundChecks(): void {
  const s = shell();
  s.listen('background:run', (id) => {
    void check()
      .catch((err: unknown) => {
        console.warn('[background] check failed', err);
        return null;
      })
      .then((result) => s.invoke('background_result', { id, result }))
      .catch(() => {});
  });
}
