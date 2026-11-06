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

  // Tauri's events: the handler gets the payload.
  var listen = function (event, callback) {
    var handler = tauri.transformCallback(function (e) { callback(e && e.payload); });
    var id = invoke('plugin:event|listen', { event: event, target: { kind: 'Any' }, handler: handler });
    return function () {
      id.then(function (eventId) { return invoke('plugin:event|unlisten', { event: event, eventId: eventId }); }).catch(function () {});
    };
  };

  // The theme and the scrims over the caption corner (lib/theme.ts): Electron
  // recoloured its OS-drawn buttons with them; here the page's own buttons
  // (components/shell/CaptionButtons.tsx) read them.
  var captionTheme = { dark: false, dim: 0 };
  define('electronTitleBar', {
    setTheme: function (isDark, dim) {
      captionTheme = { dark: !!isDark, dim: Number.isInteger(dim) ? dim : 0 };
      window.dispatchEvent(new CustomEvent('girovo:caption-theme', { detail: captionTheme }));
    },
  });

  // Windows: the page draws the caption buttons; the shell does what they do,
  // and Windows 11's snap layouts over the maximize button (src/frame.rs).
  if (boot.platform === 'windows') {
    define('electronCaption', {
      theme: function () { return captionTheme; },
      minimize: function () { return invoke('caption_minimize'); },
      toggleMaximize: function () { return invoke('caption_toggle_maximize'); },
      close: function () { return invoke('caption_close'); },
      isMaximized: function () { return invoke('caption_is_maximized'); },
      setMaxRect: function (r) {
        return invoke('caption_rect', { x: r.x, y: r.y, width: r.width, height: r.height }).catch(function () {});
      },
      // 'maximized' (the glyph), 'hover' and 'press' (the maximize button's states, from the snap overlay).
      on: function (what, callback) { return listen('caption:' + what, callback); },
    });
  }

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
