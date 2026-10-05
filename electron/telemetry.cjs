'use strict';

// Telemetry to the developer's own server (config.json → telemetry), through
// the vendored SDK (electron/telemetry-sdk.mjs, a copy of
// https://telemetry.elnino0916.de/sdk/telemetry.js — loaded from here, never
// from the network).
//
// Two kinds, two rules:
//
//   errors        always sent: crashes and unexpected failures of the shell,
//                 the server and the page. Scrubbed (telemetry-scrub.cjs) and
//                 tagged only with where they happened.
//   usage         events and metrics — which screens are used, how a login
//                 went and how long the bank took. Only after the user said
//                 yes ("Nutzungsdaten teilen", asked once on the Übersicht,
//                 changeable in the Sitzung panel).
//
// The install id — the one thing stored on the machine for this — exists only
// while usage is shared: without the yes, an error report carries just the
// SDK's per-start session id, and switching usage off deletes the id. Every
// report shows the server the user's IP address, as any request does.
//
// Only events and fields listed below can be sent, each field of a fixed type
// (telemetry-scrub.props), so nothing from the bookings can reach a report.

const scrub = require('./telemetry-scrub.cjs');

const CONSENT_PREF = 'fints.telemetry';
const ID_PREF = 'fints.telemetry.id';

const LOGIN_OUTCOMES = ['ok', 'refused', 'unreachable', 'unavailable', 'insecure', 'cancelled', 'error'];

/** The usage events and the fields each may carry. */
const EVENTS = {
  app_started: { installKind: ['nsis', 'portable', 'manual', 'dev'], locale: 'id' },
  app_closed: { minutes: 'int' },
  screen_viewed: { screen: 'id' },
  login_result: { blz: 'blz', outcome: LOGIN_OUTCOMES, restored: 'bool', tanMethods: 'int', ms: 'int' },
  export_created: { format: ['pdf', 'csv'], kind: ['statement', 'transaction', 'transactions'] },
  update_available: { version: 'version' },
  update_downloaded: { version: 'version' },
  update_installed: { from: 'version', to: 'version' },
};

/** The usage metrics and their fields. */
const METRICS = {
  'bank.request_ms': { blz: 'blz', ok: 'bool' },
  'server.start_ms': {},
};

/** Where an error happened — the only fields an error report carries. */
const ERROR_PROPS = {
  source: ['main', 'server', 'route', 'renderer', 'updater'],
  route: 'id',
  blz: 'blz',
  kind: 'id',
  during: ['check', 'download', 'install'],
  fatal: 'bool',
};

/**
 * @param {object} deps
 * @param {object|null} deps.client  an SDK instance (createTelemetry), or null: then nothing is sent
 * @param {(key: string) => string|null} deps.getPref
 * @param {(key: string, value: string) => unknown} deps.setPref
 * @param {(key: string) => unknown} deps.delPref
 * @param {() => string} deps.randomId
 */
function createTelemetryHub({ client, getPref, setPref, delPref, randomId }) {
  /** 'on' | 'off' | 'unasked' — the user's answer to "Nutzungsdaten teilen?". */
  const consent = () => {
    const v = getPref(CONSENT_PREF);
    return v === 'on' || v === 'off' ? v : 'unasked';
  };

  const installId = () => {
    let id = getPref(ID_PREF);
    if (!id) {
      id = randomId();
      setPref(ID_PREF, id);
    }
    return id;
  };

  // The user id the SDK attaches to every report: the install id with the
  // yes, none without it.
  const syncIdentity = () => client?.identify(consent() === 'on' ? installId() : undefined);
  syncIdentity();

  const hub = {
    consent,

    setConsent(on) {
      setPref(CONSENT_PREF, on ? 'on' : 'off');
      if (!on) delPref(ID_PREF);
      syncIdentity();
      return consent();
    },

    /** Always: an unexpected failure, scrubbed, with where it happened. */
    error(raw, where) {
      if (!client) return;
      const e = scrub.error(raw);
      if (e) client.captureError(e, scrub.props(where, ERROR_PROPS));
    },

    /** With the yes only: one of EVENTS. */
    event(name, props) {
      if (!client || consent() !== 'on' || !Object.hasOwn(EVENTS, name)) return;
      client.track(name, scrub.props(props, EVENTS[name]));
    },

    /** With the yes only: one of METRICS. */
    metric(name, value, props) {
      if (!client || consent() !== 'on' || !Object.hasOwn(METRICS, name)) return;
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      client.metric(name, Math.round(value), scrub.props(props, METRICS[name]));
    },

    /** Sends what is queued, waiting at most `ms` — the app is quitting. */
    async shutdown(ms = 1500) {
      if (!client) return;
      await Promise.race([
        client.shutdown().catch(() => {}),
        new Promise((resolve) => {
          const t = setTimeout(resolve, ms);
          t.unref?.();
        }),
      ]);
    },
  };
  return hub;
}

/**
 * A message from the server process (lib/telemetry.ts writes them to its
 * stdout as one line each, after MARK), handed to the hub — which decides
 * what may go out, exactly as for the shell's own reports.
 */
const MARK = '@@girovo-telemetry ';
const MAX_LINE = 256 * 1024;

function relayServerLine(hub, line) {
  let msg;
  try {
    msg = JSON.parse(line.slice(MARK.length));
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'error') {
    hub.error({ name: msg.name, message: msg.message, stack: msg.stack }, { source: 'server', ...msg.props });
  } else if (msg.t === 'event' && typeof msg.name === 'string') {
    hub.event(msg.name, msg.props);
  } else if (msg.t === 'metric' && typeof msg.name === 'string') {
    hub.metric(msg.name, msg.value, msg.props);
  }
}

/**
 * Splits a stream's chunks into lines: telemetry lines go to `onTelemetry`,
 * everything else to `onText` (with its newline), so the server's log stays
 * as it was.
 */
function lineSplitter(onTelemetry, onText) {
  let rest = '';
  return (chunk) => {
    rest += String(chunk);
    let nl;
    while ((nl = rest.indexOf('\n')) !== -1) {
      const line = rest.slice(0, nl).replace(/\r$/, '');
      rest = rest.slice(nl + 1);
      if (line.startsWith(MARK)) onTelemetry(line);
      else onText(`${line}\n`);
    }
    // A partial line that cannot become a telemetry line is passed on now;
    // one that could but never ends is dropped rather than kept growing.
    if (rest && !MARK.startsWith(rest.slice(0, MARK.length))) {
      onText(rest);
      rest = '';
    } else if (rest.length > MAX_LINE) {
      rest = '';
    }
  };
}

module.exports = {
  createTelemetryHub,
  relayServerLine,
  lineSplitter,
  MARK,
  CONSENT_PREF,
  ID_PREF,
  EVENTS,
  METRICS,
  ERROR_PROPS,
};
