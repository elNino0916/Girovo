'use client';

// "Girovo zurücksetzen" (Einstellungen → Dieses Gerät), the desktop app only:
// everything Girovo keeps on this computer goes (src-tauri/src/reset.rs) and
// it starts again as on its first day. Before the shell's part, the page ends
// the bank sessions and empties its own storage — the one thing the shell
// cannot reach while the window is open.
//
// Should a file not go (another program holds it), Girovo starts again all
// the same and finishes at that start; only if something stays even then does
// the shell leave a word for the page (LEFT_KEY), said once by ResetLeftNotice.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { store } from '@/lib/client-api';
import { useT } from '@/lib/i18n/react';
import { useFints } from '../FintsProvider';
import { AlertTriangleIcon, RefreshIcon } from '../icons';
import { Button, Dialog } from '../ui';
import { ActionItem } from './rows';

/** The banks' goodbye gets this long: a reset never waits on a bank out of reach. */
const LOGOUT_LIMIT_MS = 3000;

const noSubscribe = () => () => {};
const hasReset = () => typeof window !== 'undefined' && !!window.electronApp;

/** The page's own storage: what the WebView keeps beside the shell's files. */
async function emptyPageStorage(): Promise<void> {
  try { localStorage.clear(); } catch { /* not there */ }
  try { sessionStorage.clear(); } catch { /* not there */ }
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
  try {
    const dbs = await indexedDB.databases?.();
    for (const db of dbs ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  } catch { /* not there */ }
  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch { /* not there */ }
}

/** Set by the shell when a reset left something behind even at the next start (src-tauri/src/reset.rs LEFT_PREF). */
const LEFT_KEY = 'fints.reset.left';

const subscribeShown = (onChange: () => void) => {
  window.addEventListener('girovo:window-shown', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener('girovo:window-shown', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
};
/** On screen: not behind the start window, where nobody would read it. */
const onScreen = () => document.visibilityState === 'visible' && (window.electronWindow?.shown?.() ?? true);

/** After a reset that could not delete everything: said once, on whichever screen the app starts with. */
export function ResetLeftNotice() {
  const t = useT();
  const { toast } = useFints();
  const shown = useSyncExternalStore(subscribeShown, onScreen, () => false);
  const text = t.settings.resetApp.left;
  useEffect(() => {
    if (!shown || !hasReset() || store.get(LEFT_KEY) !== '1') return;
    store.del(LEFT_KEY);
    toast(text, 'error');
  }, [shown, text, toast]);
  return null;
}

export function ResetAppRow() {
  const t = useT();
  const { logout, toast } = useFints();
  const available = useSyncExternalStore(noSubscribe, hasReset, () => false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!available) return null;
  const words = t.settings.resetApp;

  const run = async () => {
    setBusy(true);
    try {
      await Promise.race([logout('user').catch(() => {}), new Promise((resolve) => setTimeout(resolve, LOGOUT_LIMIT_MS))]);
      await emptyPageStorage();
      // The shell deletes and starts Girovo again; this page goes with it.
      await window.electronApp!.reset();
    } catch {
      setBusy(false);
      toast(words.failed, 'error');
    }
  };

  return (
    <>
      <ActionItem icon={<RefreshIcon />} title={words.row} summary={words.rowHint} onClick={() => setOpen(true)} />
      <Dialog
        open={open}
        onClose={busy ? undefined : () => setOpen(false)}
        title={words.title}
        icon={<AlertTriangleIcon size={20} />}
        description={words.description}
        actions={
          <>
            <Button variant="secondary" data-autofocus onClick={() => setOpen(false)} disabled={busy}>{t.common.cancel}</Button>
            <Button variant="danger" busy={busy} onClick={() => void run()}>{words.confirm}</Button>
          </>
        }
      >
        {/* Indented to the title's edge, under the header's pictogram, as the other data dialogs. */}
        <p className="pl-[54px] text-[14px] leading-relaxed text-ink-2">{words.body}</p>
      </Dialog>
    </>
  );
}
