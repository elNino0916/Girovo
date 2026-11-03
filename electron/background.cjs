'use strict';

// "Neue Umsätze melden" in the desktop shell (lib/background-check.ts): every
// six hours, while Girovo runs — in the window or in the notification area —
// the shell asks its own server for a check and shows what it found as the
// system's notifications.
//
// The check itself is the server's (app/api/background, op "check"); this
// side only keeps time: the last check and whether it is on are preferences
// (prefs.json), the next one is due six hours after the last — and two
// minutes after a start or a wake from sleep at the earliest, so the server
// is up and the network back. A check that could not run is tried again
// after half an hour. The secret it needs is the one "Weitere Banken mit
// anmelden" seals with (electron/linked-unlock.cjs).
//
// Kept apart from main.cjs (prefs, the secret, the request and the
// notifications come in as arguments) so `npm test` runs it without Electron
// (background.test.cjs).

const ON_PREF = 'fints.background.on';
const LAST_PREF = 'fints.background.last';
const INTERVAL_MS = 6 * 60 * 60_000;
const SETTLE_MS = 2 * 60_000;
const RETRY_MS = 30 * 60_000;

/**
 * @param {object} deps
 * @param {{ get(key: string): string | null, set(key: string, value: string | null): void }} deps.prefs
 * @param {() => Promise<string | null>} deps.secret  The shell's secret (linked-unlock.cjs).
 * @param {(secret: string) => Promise<{ checked: number, notices: Array<{ key: string, kind: string, title: string, text: string, lines: string[] }> }>} deps.check
 * @param {(notice: { key: string, kind: string, title: string, text: string, lines: string[] }) => void} deps.notify
 * @param {() => number} [deps.now]
 * @param {{ setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout }} [deps.timers]
 * @param {{ warn(...args: unknown[]): void }} [deps.log]
 */
function createBackgroundChecks({ prefs, secret, check, notify, now = Date.now, timers = { setTimeout, clearTimeout }, log = console }) {
  let timer = null;
  let running = null;

  const enabled = () => prefs.get(ON_PREF) === '1';

  function clear() {
    if (timer) timers.clearTimeout(timer);
    timer = null;
  }

  function schedule(ms) {
    clear();
    if (!enabled()) return;
    timer = timers.setTimeout(() => {
      timer = null;
      void runNow();
    }, Math.max(0, ms));
    timer?.unref?.();
  }

  /** Six hours after the last check — but never before the app has settled. */
  function dueIn() {
    const last = Number(prefs.get(LAST_PREF)) || 0;
    return Math.max(SETTLE_MS, last + INTERVAL_MS - now());
  }

  /** One check now (a second call while one runs joins it); null when it could not run. */
  function runNow() {
    if (running) return running;
    running = (async () => {
      try {
        const s = await secret();
        if (!s) throw new Error('no secret');
        const result = await check(s);
        prefs.set(LAST_PREF, String(now()));
        for (const notice of result?.notices ?? []) {
          try {
            notify(notice);
          } catch (err) {
            log.warn('[background] notice failed:', err?.message || err);
          }
        }
        schedule(INTERVAL_MS);
        return result;
      } catch (err) {
        log.warn('[background] check failed:', err?.message || err);
        schedule(RETRY_MS);
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    enabled,
    /** At the start of the app: the next check, if it is on. */
    start() {
      if (enabled()) schedule(dueIn());
    },
    /** The switch in Einstellungen (the server already keeps or dropped the PINs). */
    setEnabled(on) {
      prefs.set(ON_PREF, on ? '1' : null);
      if (on) schedule(SETTLE_MS);
      else clear();
    },
    /** Back from sleep: timers stood still meanwhile. */
    resumed() {
      if (enabled()) schedule(dueIn());
    },
    runNow,
    stop: clear,
  };
}

/**
 * The server's check, asked over its own port with the language cookie, so
 * its notices come in the app's language.
 *
 * @param {object} deps
 * @param {() => string} deps.origin  The server's origin (http://127.0.0.1:<port>).
 * @param {() => string | null} deps.locale
 * @param {string} deps.cookie  The language cookie's name (i18n.cjs).
 * @param {typeof fetch} [deps.fetch]
 */
function serverCheck({ origin, locale, cookie, fetch: fetchImpl = fetch }) {
  return async (secret) => {
    const lang = locale();
    const res = await fetchImpl(`${origin()}/api/background`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(lang ? { cookie: `${cookie}=${lang}` } : {}),
      },
      body: JSON.stringify({ op: 'check', secret }),
      // A check of a few banks takes a minute at most; a hung one must not block the next.
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!res.ok) throw new Error(`server answered ${res.status}`);
    return res.json();
  };
}

module.exports = { createBackgroundChecks, serverCheck, ON_PREF, LAST_PREF, INTERVAL_MS, SETTLE_MS, RETRY_MS };
