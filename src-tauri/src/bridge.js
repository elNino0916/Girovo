// The page's bridges to the shell, as electron/preload.cjs gave them — the
// same names and shapes, so the page does not know which shell it runs in.
// Runs before any script of the page (src/shell.rs boot_script), with
// window.__GIROVO_BOOT__ already set: the preferences, read synchronously.
//
// A bridge the Tauri shell does not offer yet is left out; the page hides
// what needs it, exactly as in a plain browser.
(function () {
  'use strict';
  var boot = window.__GIROVO_BOOT__ || {};
  var tauri = window.__TAURI_INTERNALS__;
  if (!tauri || typeof tauri.invoke !== 'function') return;
  var invoke = function (cmd, args) { return tauri.invoke(cmd, args || {}); };
  var define = function (name, value) {
    Object.defineProperty(window, name, { value: Object.freeze(value), enumerable: false, configurable: false, writable: false });
  };

  // Preferences: synchronous reads from the snapshot, writes through to prefs.json.
  var PREF_KEY = /^fints\.[\w.-]{1,80}$/;
  var PREF_VALUE_MAX = 4096;
  var prefs = Object.assign(Object.create(null), boot.prefs || {});
  define('electronStore', {
    get: function (key) {
      if (typeof key !== 'string' || !PREF_KEY.test(key)) return null;
      var v = prefs[key];
      return typeof v === 'string' ? v : null;
    },
    set: function (key, value) {
      if (typeof key !== 'string' || !PREF_KEY.test(key)) return;
      if (typeof value !== 'string' || value.length > PREF_VALUE_MAX) return;
      prefs[key] = value;
      invoke('prefs_set', { key: key, value: value }).catch(function () {});
    },
    del: function (key) {
      if (typeof key !== 'string' || !PREF_KEY.test(key)) return;
      delete prefs[key];
      invoke('prefs_set', { key: key, value: null }).catch(function () {});
    },
  });

  define('electronTitleBar', {
    setTheme: function (isDark, dim) {
      invoke('titlebar_set_theme', { dark: !!isDark, dim: Number.isInteger(dim) ? dim : 0 }).catch(function () {});
    },
  });

  define('electronWindow', {
    requestAttention: function (on) {
      invoke('window_attention', { on: on === true }).catch(function () {});
    },
  });

  // Telemetry: nothing leaves until the hub is ported; the consent question stays unasked.
  define('electronTelemetry', {
    consent: function () {
      var v = prefs['fints.telemetry'];
      return v === 'on' || v === 'off' ? v : 'unasked';
    },
    setConsent: function () { return Promise.resolve(); },
    event: function () {},
    error: function () {},
  });

  // The shell's own facts, for desktop/runtime.ts.
  define('__girovoShell', { platform: String(boot.platform || ''), version: String(boot.version || ''), invoke: invoke });
})();
