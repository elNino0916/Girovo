// Telemetry in the Android app, by the desktop's own rules
// (electron/telemetry.cjs): error reports always, scrubbed and tagged only
// with where they happened; usage only after the user's yes ("Nutzungsdaten
// teilen", asked once on the Übersicht, changeable in the Sitzung panel); only
// the events and fields that module declares. Sent by the vendored SDK
// (electron/telemetry-sdk.mjs) to config.json's endpoint, through the app's
// native HTTP like every other request.
//
// The page reaches it as it reaches the desktop shell's (window.electronTelemetry),
// so the consent tile, the Sitzung switch and the page's error capture work
// unchanged. The route handlers — they run in this page too — report through
// lib/telemetry.ts's sink.
//
// Without the yes there is no install id: the SDK's persistent anonymous id
// stays off, so a report carries only the id of this start. A debug build
// sends nothing, so development stays out of the reports — unless the
// developer turns it on for testing (localStorage fints.telemetry.debug = 1),
// and then as "development".

import telemetry from '../../electron/telemetry.cjs';
import { createTelemetry } from '../../electron/telemetry-sdk.mjs';
import config from '../../config.json';
import { GirovoDevice } from '../native';

type Hub = ReturnType<typeof telemetry.createTelemetryHub>;

const prefs = {
  getPref: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setPref: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch { /* kept for this run */ }
  },
  delPref: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch { /* nothing to delete */ }
  },
  randomId: () => crypto.randomUUID(),
};

/** Until the client is up (and for good in a debug build) the hub sends nothing. */
let hub: Hub = telemetry.createTelemetryHub({ client: null, ...prefs });

// What comes before the client is up — the first moments of a start — waits
// for it, a few reports at most; once it is clear there is none, they go.
let settled = false;
const early: ((h: Hub) => void)[] = [];
const EARLY_MAX = 50;
function send(fn: (h: Hub) => void): void {
  if (settled) fn(hub);
  else if (early.length < EARLY_MAX) early.push(fn);
}
function settle(): void {
  settled = true;
  for (const fn of early.splice(0)) fn(hub);
}

/** A usage event (with the yes only), for the runtime's own parts: the updater. */
export const track = (name: string, props?: Record<string, string | number | boolean>) => send((h) => h.event(name, props));

/** An unexpected failure, for the runtime's own parts: always, scrubbed. */
export const reportError = (err: unknown, where: Record<string, string | boolean>) => send((h) => h.error(err, where));

/** Installs the page's bridge at once; reports start once the SDK is set up. */
export function startTelemetry(): void {
  window.electronTelemetry = {
    consent: () => hub.consent(),
    setConsent: async (on) => hub.setConsent(on),
    event: (name, props) => send((h) => h.event(name, props)),
    error: (err) => send((h) => h.error(err, { source: 'renderer' })),
  };
  // lib/telemetry.ts: the route handlers' reports, as the desktop relays its server's.
  (globalThis as { __girovoTelemetrySink?: (message: Record<string, unknown>) => void }).__girovoTelemetrySink = (message) =>
    send((h) => telemetry.relayServerLine(h, `${telemetry.MARK}${JSON.stringify(message)}`));

  void (async () => {
    const block = (config as { telemetry?: { endpoint?: unknown; key?: unknown } }).telemetry;
    const info = await GirovoDevice.info().catch(() => null);
    const testing = !!info?.debug && prefs.getPref('fints.telemetry.debug') === '1';
    if (!info || (info.debug && !testing) || typeof block?.endpoint !== 'string' || typeof block.key !== 'string') {
      settle();
      return;
    }
    try {
      const version = info.versionName;
      const client = createTelemetry({
        endpoint: block.endpoint,
        key: block.key,
        release: version,
        environment: info.debug || version.includes('-') ? 'development' : 'production',
        client: 'Girovo Android',
        clientVersion: version,
        anonymousId: false,
        // The page's errors come through its own capture (components/telemetry), scrubbed by the hub.
        captureErrors: false,
      });
      client.setContext({ osVersion: `Android API ${info.sdk}`, device: 'phone' });
      hub = telemetry.createTelemetryHub({ client, ...prefs });
      hub.event('app_started', { installKind: info.flavor === 'play' ? 'play' : 'apk', locale: info.locale });
    } catch (err) {
      console.warn('[telemetry] unavailable:', err instanceof Error ? err.message : err);
    }
    settle();
  })();
}
