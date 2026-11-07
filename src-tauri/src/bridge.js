// The page's bridges to the shell, as the Electron shell's preload.cjs gave them — the
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
  // The telemetry keys are the hub's (electronTelemetry.setConsent): a yes, a
  // no and the install id change together, never one of them on its own.
  var PREF_KEY = /^fints\.[\w.-]{1,80}$/;
  var HUB_KEY = /^fints\.telemetry(?:\.|$)/;
  var PREF_VALUE_MAX = 4096;
  var prefs = Object.assign(Object.create(null), boot.prefs || {});
  var pageKey = function (key) { return typeof key === 'string' && PREF_KEY.test(key) && !HUB_KEY.test(key); };
  define('electronStore', {
    get: function (key) {
      if (!pageKey(key)) return null;
      var v = prefs[key];
      return typeof v === 'string' ? v : null;
    },
    set: function (key, value) {
      if (!pageKey(key)) return;
      if (typeof value !== 'string' || value.length > PREF_VALUE_MAX) return;
      prefs[key] = value;
      invoke('prefs_set', { key: key, value: value }).catch(function () {});
    },
    del: function (key) {
      if (!pageKey(key)) return;
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

  // Whether the window is on screen (src/shell.rs SHOWN_EVENT): WebView2 says
  // a page in a hidden window is visible, and even focused for a moment, so
  // the page's "in front" (useWindowInFront) asks the shell as well.
  var shown = false;
  var setShown = function (on) {
    if (shown === on) return;
    shown = on;
    window.dispatchEvent(new CustomEvent('girovo:window-shown', { detail: on }));
  };
  listen('window:shown', function (on) { setShown(on === true); });
  invoke('window_shown').then(function (on) { setShown(on === true); }).catch(function () {});
  define('electronWindow', {
    requestAttention: function (on) {
      invoke('window_attention', { on: on === true }).catch(function () {});
    },
    shown: function () { return shown; },
  });

  // "Girovo zurücksetzen" (src/reset.rs): everything on this computer goes, and
  // the app starts again — the promise never settles in the page that asked.
  define('electronApp', {
    reset: function () { return invoke('app_reset'); },
  });

  // The shell secret (src/secret.rs): base64, or null where this system has no
  // protected store for it — the page then does not offer what needs it.
  define('electronLinkedUnlock', {
    secret: function () { return invoke('linked_unlock_secret'); },
  });

  // Windows Hello (src/hello.rs), with the Electron shell's windows-hello.cjs's answers;
  // available() is false off Windows.
  define('electronHello', {
    available: function () { return invoke('hello_available'); },
    enroll: function () { return invoke('hello_enroll'); },
    unlock: function () { return invoke('hello_unlock'); },
  });

  // In-app updates (src/updater). Every call answers with the updater's
  // state; onState hears every change, download progress included, and
  // returns its own unsubscribe.
  define('electronUpdater', {
    getState: function () { return invoke('updater_get'); },
    check: function () { return invoke('updater_check'); },
    download: function () { return invoke('updater_download'); },
    cancel: function () { return invoke('updater_cancel'); },
    install: function () { return invoke('updater_install'); },
    // The installed Windows app: quit and start again, the start window installing the update.
    restartToUpdate: function () { return invoke('updater_restart'); },
    setAuto: function (on) { return invoke('updater_set_auto', { on: on === true }); },
    setEarly: function (on) { return invoke('updater_set_early', { on: on === true }); },
    chooseFile: function () { return invoke('updater_choose_file'); },
    installFile: function () { return invoke('updater_install_file'); },
    dismissFile: function () { return invoke('updater_dismiss_file'); },
    setChannel: function (channel) { return invoke('updater_set_channel', { channel: channel === 'preview' ? 'preview' : 'stable' }); },
    openRelease: function () { return invoke('updater_open_release'); },
    onState: function (callback) {
      if (typeof callback !== 'function') return function () {};
      return listen('updater:state', callback);
    },
  });

  // Saving a file the app made (the CSV export, a backup) through a native
  // Save As, answered once the file is written or the dialog dismissed
  // (src/save.rs). The bytes go as the request's body, as they are; the name
  // URI-encoded beside them, since a header carries only ASCII. Anything but
  // bytes goes as nothing: the shell refuses it before any dialog, in its
  // own language.
  var wellFormed = function (text) {
    return typeof text.toWellFormed === 'function' ? text.toWellFormed() : text.replace(/[\uD800-\uDFFF]/g, '\uFFFD');
  };
  define('electronFiles', {
    save: function (suggestedName, bytes) {
      var name = encodeURIComponent(wellFormed(String(suggestedName == null ? '' : suggestedName)));
      return tauri.invoke('file_save', ArrayBuffer.isView(bytes) ? bytes : {}, { headers: { 'girovo-name': name } });
    },
  });

  // The PDF export (Statement.tsx): the page printed straight out of WebView2
  // with its print stylesheet, then a native Save As (src/pdf.rs). Windows
  // only; elsewhere the page prints through window.print().
  if (boot.platform === 'windows') {
    define('electronPDF', {
      exportPDF: function (suggestedName) {
        return invoke('pdf_export', { suggestedName: String(suggestedName == null ? '' : suggestedName) });
      },
    });
  }

  // Sync between devices (lib/sync.ts): the home network's file shelf
  // (src/sync_lan.rs) — on, with where the phone finds it, or off — a folder
  // of the user's choosing, and this computer's name for the others.
  define('electronSync', {
    lan: function (on) { return invoke('sync_lan', { on: on === true }); },
    pickFolder: function () { return invoke('sync_pick_folder'); },
    deviceName: function () { return invoke('sync_device_name'); },
  });

  // Telemetry (src/telemetry.rs). The page's errors always go to the shell,
  // which scrubs them; its usage events only count once the user said yes —
  // consent() is that answer ('on', 'off' or 'unasked'), read synchronously
  // from the snapshot so the Übersicht knows at first paint whether to ask,
  // and kept in step with the hub's answer to setConsent.
  var short = function (value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; };
  define('electronTelemetry', {
    consent: function () {
      var v = prefs['fints.telemetry'];
      return v === 'on' || v === 'off' ? v : 'unasked';
    },
    setConsent: function (on) {
      return invoke('telemetry_set_consent', { on: on === true }).then(function (answer) {
        if (answer === 'on' || answer === 'off') prefs['fints.telemetry'] = answer;
        if (answer === 'off') delete prefs['fints.telemetry.id'];
        return answer;
      });
    },
    event: function (name, props) {
      if (typeof name !== 'string' || name.length > 64) return;
      invoke('telemetry_event', { name: name, props: props && typeof props === 'object' ? Object.assign({}, props) : {} }).catch(function () {});
    },
    error: function (err) {
      var e = { name: short(err && err.name, 80), message: short(err && err.message, 2000), stack: short(err && err.stack, 8000) };
      invoke('telemetry_error', { err: e }).catch(function () {});
    },
  });
  // The page ready: how long the start took (the Electron shell's ready-to-show).
  // Not at its first frame: the window loads hidden behind the start window,
  // and a hidden WebView2 may hold its frames back until it is shown.
  var drawn = function () { invoke('telemetry_shown').catch(function () {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawn, { once: true });
  else drawn();

  // "Neue Umsätze melden" (src/background.rs): the shell plans the checks and
  // keeps the notification area; the page runs them (desktop/background.ts).
  define('electronBackground', {
    set: function (on) { return invoke('background_set', { on: on === true }); },
    // The window closed into the notification area: the page ends its bank session.
    onHidden: function (callback) {
      if (typeof callback !== 'function') return function () {};
      return listen('window:hidden-to-tray', function () { callback(); });
    },
    // A system notice while nobody sees the window (a logout that left a transfer unclear).
    notice: function (notice) {
      var n = notice && typeof notice === 'object' ? notice : {};
      var text = function (v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; };
      return invoke('background_notice', { notice: { title: text(n.title, 200), text: text(n.text, 2000) } });
    },
  });

  // Zooming from the keyboard, as in a browser (the Electron shell's zoom.cjs): by the
  // character the key types, so a German keyboard's "+" works; never with Alt,
  // since AltGr is Ctrl+Alt and types characters of its own.
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var command = null;
    if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') command = 'in';
    else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') command = 'out';
    else if (e.key === '0' || e.code === 'Numpad0') command = 'reset';
    if (!command) return;
    e.preventDefault();
    invoke('zoom_step', { command: command }).catch(function () {});
  }, true);

  // No reload: F5, Strg+R and the browser's own menu ("Aktualisieren") would
  // start the page and its server over — the bank session gone, an approval
  // under way lost, and the preferences as this window was given them at its
  // start (the Electron shell had neither key nor menu). Text fields and a
  // selection keep their menu: cut, copy, paste.
  window.addEventListener('keydown', function (e) {
    var key = e.key;
    var reload = key === 'F5' || key === 'BrowserRefresh'
      || ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'r' || key === 'R'));
    if (reload) e.preventDefault();
  }, true);
  window.addEventListener('contextmenu', function (e) {
    var t = e.target;
    var editable = t && t.closest && t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
    var selected = String(window.getSelection ? window.getSelection() : '').length > 0;
    if (!editable && !selected) e.preventDefault();
  }, true);

  // The shell's own facts, for desktop/runtime.ts.
  // invokeRaw: bytes as the request's body, with headers (src/files.rs fs_write).
  var invokeRaw = function (cmd, bytes, headers) { return tauri.invoke(cmd, bytes, { headers: headers || {} }); };
  define('__girovoShell', { platform: String(boot.platform || ''), version: String(boot.version || ''), invoke: invoke, invokeRaw: invokeRaw, listen: listen });
})();
