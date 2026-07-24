'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const api = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler (${res.status})`);
  return data;
};
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtMoney = (v, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(v ?? 0);
const fmtDate = (d) => (d ? new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : '');
const fmtIban = (iban) => (iban ? String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() : '');

const showView = (id) => {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('#' + id).classList.add('active');
};
const showError = (sel, msg) => {
  const n = $(sel);
  if (!msg) { n.hidden = true; return; }
  n.textContent = msg; n.hidden = false;
};
const openOverlay = (id) => { $('#' + id).classList.add('open'); };
const closeOverlay = (id) => { $('#' + id).classList.remove('open'); };

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

function toast(msg, isError = false, ms = 4200) {
  const t = el('div', 'toast' + (isError ? ' err' : ''), escapeHtml(msg));
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// Big balance: euros large, cents small — the statement look.
function balanceHtml(v, cur = 'EUR') {
  const parts = new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).formatToParts(v ?? 0);
  let euros = '', cents = '', suffix = '';
  let inFraction = false;
  for (const p of parts) {
    if (p.type === 'decimal') { inFraction = true; cents += p.value; continue; }
    if (p.type === 'fraction') { cents += p.value; continue; }
    if (p.type === 'currency') { suffix = p.value; continue; }
    if (p.type === 'literal' && inFraction) continue;
    euros += p.value;
  }
  return `${escapeHtml(euros.trim())}<span class="cents">${escapeHtml(cents)}&nbsp;${escapeHtml(suffix)}</span>`;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set('fints.theme', t);
  $('#theme-icon-sun').hidden = t === 'dark';
  $('#theme-icon-moon').hidden = t !== 'dark';
}
$('#theme-toggle').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});
applyTheme(document.documentElement.dataset.theme || 'light');

// ---------------------------------------------------------------------------
// Bank brand marks — abstract SVG chips in each group's brand color.
// ---------------------------------------------------------------------------
const BRANDS = {
  sparkasse:       { bg: '#e8412c', mark: 'S·' },
  vrbank:          { bg: '#0a4a8a', mark: 'VR', accent: '#f60' },
  deutschebank:    { bg: '#0018a8', mark: 'slash' },
  commerzbank:     { bg: '#ffcc33', mark: 'C', fg: '#1a1a1a' },
  postbank:        { bg: '#ffcc00', mark: 'P', fg: '#0066b3' },
  ing:             { bg: '#ff6200', mark: 'i' },
  dkb:             { bg: '#1482c8', mark: 'DKB' },
  comdirect:       { bg: '#fff04b', mark: 'c', fg: '#00376c' },
  hypovereinsbank: { bg: '#e20015', mark: 'HV' },
  targobank:       { bg: '#00549f', mark: 'T' },
  norisbank:       { bg: '#d51130', mark: 'n' },
  consorsbank:     { bg: '#002e5c', mark: 'C', accent: '#21e6c1' },
  sparda:          { bg: '#e3001b', mark: 'S' },
  psd:             { bg: '#00589c', mark: 'PSD' },
  apobank:         { bg: '#003366', mark: 'a' },
  gls:             { bg: '#7ab41d', mark: 'GLS', fg: '#173d0a' },
  triodos:         { bg: '#008996', mark: 't' },
  ethikbank:       { bg: '#5a8f22', mark: 'e' },
  oldenburgische:  { bg: '#0f2d5a', mark: 'OLB' },
  degussa:         { bg: '#1c3f94', mark: 'D' },
  generic:         { bg: '#5b6b72', mark: '€' },
};

// Real logo files available under /logos (filled from /api/logos at boot).
const logoFiles = new Map(); // brand -> filename

// Marks that are too dark to sit on the dark theme directly (navy/black
// wordmarks, measured per file) get an invert+hue-rotate in dark mode.
// Colorful marks (Sparkasse red, comdirect yellow, DKB blue, …) render as-is.
const DARK_INVERT = new Set([
  'vrbank', 'ing', 'gls', 'apobank', 'psd', 'norisbank',
  'commerzbank', 'hypovereinsbank', 'degussa', 'targobank',
]);

function logoSvg(brand, size = '') {
  const file = logoFiles.get(brand);
  if (file) {
    const inv = DARK_INVERT.has(brand) ? ' lg-inv' : '';
    return `<span class="logo logo-img${inv} ${size}"><img src="/logos/${file}" alt="" loading="lazy"></span>`;
  }
  const b = BRANDS[brand] || BRANDS.generic;
  const fg = b.fg || '#ffffff';
  let inner;
  if (b.mark === 'slash') {
    // square with rising diagonal — the classic German bank geometry
    inner = `<rect x="22" y="22" width="56" height="56" fill="none" stroke="${fg}" stroke-width="7"/>` +
            `<path d="M32 68 L68 32" stroke="${fg}" stroke-width="8"/>`;
  } else if (brand === 'sparkasse') {
    inner = `<circle cx="63" cy="25" r="11" fill="${fg}"/>` +
            `<text x="44" y="60" dy=".36em" text-anchor="middle" font-family="'Barlow','Segoe UI',sans-serif" font-weight="700" font-size="58" fill="${fg}">S</text>`;
  } else {
    const len = String(b.mark).length;
    const fs = len >= 3 ? 32 : len === 2 ? 42 : 56;
    inner = `<text x="50" y="50" dy=".36em" text-anchor="middle" font-family="'Barlow','Segoe UI',sans-serif" font-weight="700" font-size="${fs}" fill="${b.fg || '#fff'}">${b.mark}</text>`;
  }
  const accent = b.accent ? `<rect x="0" y="86" width="100" height="14" fill="${b.accent}"/>` : '';
  return `<span class="logo ${size}" style="background:${b.bg}"><svg viewBox="0 0 100 100" role="img" aria-hidden="true">${inner}${accent}</svg></span>`;
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  sessionId: null,
  bank: null,          // chosen bank {blz, name, brand, url?, bic?, hint?}
  banks: [],           // quick picks
  tanMethods: [],
  selectedMethod: null,
  accounts: [],
  activeAccount: null,
  balances: {},        // accountNumber -> balance
  txCache: {},         // accountNumber -> { key, txs }
  txFilter: { from: undefined, to: undefined },
  pollTimer: null,
  busy: false,
  loadingAccount: null,
  transferDraft: null,
  userId: null,
  deviceRemembered: false,
};

// ---------------------------------------------------------------------------
// LOGIN — bank picking
// ---------------------------------------------------------------------------
async function boot() {
  try {
    const meta = await fetch('/api/meta').then((r) => r.json());
    $('#bank-count').textContent = new Intl.NumberFormat('de-DE').format(meta.bankCount);
    $('#product-warn').hidden = meta.productRegistered;
  } catch { /* server down; errors surface on connect */ }

  try {
    const files = await fetch('/api/logos').then((r) => r.json());
    files.forEach((f) => {
      const brand = f.replace(/\.(svg|png)$/i, '');
      // prefer svg over png when both exist
      if (!logoFiles.has(brand) || /\.svg$/i.test(f)) logoFiles.set(brand, f);
    });
  } catch { /* fall back to monogram chips */ }

  try {
    state.banks = await fetch('/api/banks').then((r) => r.json());
  } catch { state.banks = []; }
  renderBankGrid();

  // Restore the last used bank
  const last = store.get('fints.lastBank');
  if (last) {
    try { chooseBank(JSON.parse(last)); } catch {}
  }
}

function renderBankGrid() {
  const grid = $('#bank-grid');
  grid.innerHTML = '';
  state.banks.slice(0, 8).forEach((b) => {
    const chip = el('button', 'bankchip');
    chip.type = 'button';
    chip.innerHTML = `${logoSvg(b.brand)}<span class="cname">${escapeHtml(b.name)}</span>`;
    chip.addEventListener('click', () => {
      if (b.blz && b.url) {
        chooseBank({ blz: b.blz, name: b.fullName || b.name, brand: b.brand, bic: b.bic, hint: b.hint });
      } else {
        // regional group (Sparkasse, VR, …) — hand over to the search
        const inp = $('#bank-search');
        inp.value = b.search || b.name;
        inp.focus();
        runBankSearch(inp.value);
      }
    });
    grid.appendChild(chip);
  });
}

let searchTimer = null;
$('#bank-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#bank-results').hidden = true; return; }
  searchTimer = setTimeout(() => runBankSearch(q), 180);
});
$('#bank-search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#bank-results').hidden = true;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.banksearch')) $('#bank-results').hidden = true;
});

async function runBankSearch(q) {
  let results = [];
  try {
    results = await fetch(`/api/bank-search?q=${encodeURIComponent(q)}`).then((r) => r.json());
  } catch { results = []; }
  const box = $('#bank-results');
  box.innerHTML = '';
  if (!results.length) {
    box.appendChild(el('div', 'bs-none', 'Keine Bank gefunden. BLZ prüfen oder anders suchen.'));
  }
  results.forEach((b) => {
    const item = el('button', 'bs-item');
    item.type = 'button';
    item.innerHTML =
      `${logoSvg(b.brand, 'logo-sm')}` +
      `<span style="min-width:0"><span class="bs-name">${escapeHtml(b.name)}</span>` +
      `<span class="bs-meta">${escapeHtml(b.blz)}${b.bic ? ' · ' + escapeHtml(b.bic) : ''}${b.location ? ' · ' + escapeHtml(b.location) : ''}</span></span>`;
    item.addEventListener('click', () => {
      box.hidden = true;
      $('#bank-search').value = '';
      chooseBank({ blz: b.blz, name: b.name, location: b.location, brand: b.brand, bic: b.bic });
    });
    box.appendChild(item);
  });
  box.hidden = false;
}

function chooseBank(bank) {
  state.bank = bank;
  $('#bank-step').hidden = true;
  $('#login-form').hidden = false;
  $('#chosen-logo').innerHTML = logoSvg(bank.brand, 'logo-lg');
  $('#chosen-name').textContent = bank.name;
  $('#chosen-meta').textContent = `BLZ ${bank.blz}${bank.location ? ' · ' + bank.location : ''}`;
  $('#tan-hint').textContent = bank.hint || '';
  $('#userId').value = store.get(`fints.userId.${bank.blz}`) || '';
  ($('#userId').value ? $('#pin') : $('#userId')).focus();
  refreshDeviceHint();
}

// Show a hint when this (bank, login name) has a remembered device, so the
// user knows the PIN they type will unlock it (fewer TAN prompts).
let deviceHintTimer = null;
async function refreshDeviceHint() {
  clearTimeout(deviceHintTimer);
  const hintEl = $('#device-hint');
  const blz = state.bank?.blz;
  const userId = $('#userId').value.trim();
  if (!blz || !userId) { hintEl.hidden = true; return; }
  deviceHintTimer = setTimeout(async () => {
    try {
      const { remembered } = await fetch(`/api/device-status?blz=${encodeURIComponent(blz)}&userId=${encodeURIComponent(userId)}`).then((r) => r.json());
      hintEl.hidden = !remembered;
    } catch { hintEl.hidden = true; }
  }, 250);
}
$('#userId').addEventListener('input', refreshDeviceHint);

$('#change-bank').addEventListener('click', () => {
  state.bank = null;
  $('#login-form').hidden = true;
  $('#bank-step').hidden = false;
  showError('#login-error', null);
});

// ---------------------------------------------------------------------------
// LOGIN — connect
// ---------------------------------------------------------------------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.bank) return;
  showError('#login-error', null);
  const btn = $('#login-btn');
  btn.disabled = true;
  btn.querySelector('.btn-label').textContent = 'Verbinde mit der Bank …';
  btn.querySelector('.spinner').hidden = false;

  try {
    const userId = $('#userId').value.trim();
    const data = await api('/api/connect', {
      blz: state.bank.blz,
      userId,
      pin: $('#pin').value,
    });

    store.set('fints.lastBank', JSON.stringify(state.bank));
    store.set(`fints.userId.${state.bank.blz}`, userId);

    state.sessionId = data.sessionId;
    state.bank = { ...state.bank, ...data.bank };
    state.userId = userId;
    $('#pin').value = '';

    (data.bankMessages || []).forEach((m) => m?.subject && toast(`${m.subject}`, false, 6000));

    if (data.restored) {
      // Remembered device: cached accounts + TAN method, no sync SCA.
      state.accounts = data.accounts || [];
      state.selectedMethod = data.selectedTanMethod || null;
      state.tanMethods = data.selectedTanMethod ? [data.selectedTanMethod] : [];
      state.deviceRemembered = true;
      toast('Gerät erkannt — ohne neue TAN angemeldet.');
      afterAccountsReady();
    } else {
      state.tanMethods = data.tanMethods || [];
      renderTanMethods();
    }
  } catch (err) {
    showError('#login-error', err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-label').textContent = 'Anmelden';
    btn.querySelector('.spinner').hidden = true;
  }
});

// ---------------------------------------------------------------------------
// TAN METHOD SELECTION
// ---------------------------------------------------------------------------
function renderTanMethods() {
  const list = $('#tanmethod-list');
  list.innerHTML = '';
  showError('#tanmethod-error', null);
  $('#tanmethod-title').textContent = 'Sicherheitsverfahren';
  $('#tanmethod-lead').textContent = 'Wähle, wie du den Zugriff freigibst.';

  if (state.tanMethods.length === 0) {
    showError('#tanmethod-error', 'Die Bank bietet keine TAN-Verfahren für diesen Zugang an.');
    showView('view-tanmethod');
    return;
  }
  if (state.tanMethods.length === 1) {
    showView('view-tanmethod');
    selectTanMethod(state.tanMethods[0]);
    return;
  }

  state.tanMethods.forEach((m) => {
    const btn = el('button', 'option');
    btn.type = 'button';
    const media = m.activeTanMedia && m.activeTanMedia.length ? ` · ${m.activeTanMedia.join(', ')}` : '';
    btn.innerHTML =
      `<div class="option-body">` +
        `<div class="option-name">${escapeHtml(m.name)}</div>` +
        `<div class="option-sub">${m.isDecoupled ? 'Direktfreigabe in der App' : 'TAN-Eingabe'}${escapeHtml(media)}</div>` +
      `</div>` +
      (m.isDecoupled ? '<span class="badge">Direktfreigabe</span>' : arrowSvg());
    btn.addEventListener('click', () => selectTanMethod(m));
    list.appendChild(btn);
  });

  showView('view-tanmethod');
}

const arrowSvg = () =>
  '<svg class="option-arrow" viewBox="0 0 24 24" width="18" height="18"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function selectTanMethod(method, tanMediaName) {
  state.selectedMethod = method;
  showError('#tanmethod-error', null);
  try {
    const media = tanMediaName || (method.activeTanMedia && method.activeTanMedia.length === 1
      ? method.activeTanMedia[0] : undefined);
    const data = await api('/api/select-tan', {
      sessionId: state.sessionId,
      tanMethodId: method.id,
      tanMediaName: media,
    });

    if (data.chooseTanMedia) {
      renderMediaChooser(method, data.chooseTanMedia);
      return;
    }
    if (data.needsTan) {
      startDecoupledWait(method, data, (r) => {
        state.accounts = r.accounts || [];
        if (r.deviceSaved) notifyDeviceSaved();
        afterAccountsReady();
      }, () => selectTanMethod(method, media));
    } else {
      state.accounts = data.accounts || [];
      if (data.deviceSaved) notifyDeviceSaved();
      afterAccountsReady();
    }
  } catch (err) {
    showError('#tanmethod-error', err.message);
  }
}

function notifyDeviceSaved() {
  state.deviceRemembered = true;
  toast('Gerät gemerkt — künftige Anmeldungen brauchen seltener eine TAN.', false, 6000);
}

function renderMediaChooser(method, names) {
  const list = $('#tanmethod-list');
  list.innerHTML = '';
  $('#tanmethod-title').textContent = 'Gerät wählen';
  $('#tanmethod-lead').textContent = 'Auf welchem Gerät möchtest du freigeben?';
  names.forEach((name) => {
    const btn = el('button', 'option');
    btn.type = 'button';
    btn.innerHTML = `<div class="option-body"><div class="option-name">${escapeHtml(name)}</div></div>${arrowSvg()}`;
    btn.addEventListener('click', () => selectTanMethod(method, name));
    list.appendChild(btn);
  });
  showView('view-tanmethod');
}

$('#tanmethod-back').addEventListener('click', () => showView('view-login'));

// ---------------------------------------------------------------------------
// DECOUPLED TAN WAIT + POLLING (overlay, shared by login/statements/transfer)
// ---------------------------------------------------------------------------
let waitCtx = null; // { onDone, onDialogEnded, retry }

function startDecoupledWait(method, data, onDone, retry, opts = {}) {
  openOverlay('ov-tanwait');
  showError('#tanwait-error', null);
  $('#tanwait-title').textContent = opts.title || 'Freigabe in deiner App';
  $('#tanwait-text').textContent = method?.isDecoupled
    ? `Öffne „${method.name}“ und bestätige die Anfrage.`
    : 'Bestätige die Anfrage in deiner Banking-App.';
  const ch = $('#tanwait-challenge');
  if (data.tanChallenge) { ch.textContent = data.tanChallenge; ch.hidden = false; }
  else ch.hidden = true;
  $('#tanwait-status').textContent = 'Warte auf Bestätigung …';
  $('#tanwait-spinnerrow').hidden = false;
  $('#tanwait-retry').hidden = true;

  waitCtx = { onDone, retry, onDialogEnded: opts.onDialogEnded };
  const interval = (method?.decoupled?.waitBetween || 2) * 1000;
  const firstDelay = (method?.decoupled?.waitBeforeFirst || 1) * 1000;

  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(poll, Math.max(1000, firstDelay));

  async function poll() {
    try {
      const r = await api('/api/tan-poll', { sessionId: state.sessionId });
      if (r.status === 'pending') {
        state.pollTimer = setTimeout(poll, Math.max(1500, interval));
        return;
      }
      if (r.status === 'dialog_ended') {
        if (waitCtx?.onDialogEnded) { waitCtx.onDialogEnded(r); return; }
        showDialogEnded();
        return;
      }
      $('#tanwait-status').textContent = 'Bestätigt ✓';
      setTimeout(() => closeOverlay('ov-tanwait'), 350);
      if (waitCtx?.onDone) waitCtx.onDone(r);
    } catch (err) {
      showError('#tanwait-error', err.message);
      $('#tanwait-spinnerrow').hidden = true;
      $('#tanwait-retry').hidden = !waitCtx?.retry;
    }
  }
}

function showDialogEnded() {
  $('#tanwait-spinnerrow').hidden = true;
  $('#tanwait-title').textContent = 'Freigabe nicht rechtzeitig angekommen';
  $('#tanwait-text').textContent =
    'Die Bank hat den Vorgang beendet, bevor die Freigabe verarbeitet wurde. ' +
    'Bitte erneut starten und die Freigabe zügig bestätigen.';
  $('#tanwait-retry').hidden = !waitCtx?.retry;
}

$('#tanwait-retry').addEventListener('click', () => {
  $('#tanwait-retry').hidden = true;
  const retry = waitCtx?.retry;
  closeOverlay('ov-tanwait');
  if (typeof retry === 'function') retry();
});

$('#tanwait-cancel').addEventListener('click', async () => {
  clearTimeout(state.pollTimer);
  state.busy = false;
  state.loadingAccount = null;
  closeOverlay('ov-tanwait');
  try { await api('/api/cancel-pending', { sessionId: state.sessionId }); } catch {}
  if (!state.accounts.length) showView('view-login');
  else renderAccounts();
});

function decoupledMethod() {
  return state.selectedMethod || state.tanMethods.find((m) => m.isDecoupled) || state.tanMethods[0];
}

// ---------------------------------------------------------------------------
// DASHBOARD
//
// Every read on the bank may need its own SCA approval, so operations are
// strictly serialized (state.busy). A single statement query yields both the
// transactions AND the balance.
// ---------------------------------------------------------------------------
function afterAccountsReady() {
  $('#topbar-bank').textContent = state.bank?.name || 'Sooskasse-FinTS';
  $('#topbar-blz').textContent = state.bank?.blz ? `BLZ ${state.bank.blz}` : '';
  $('#topbar-logo').innerHTML = logoSvg(state.bank?.brand || 'generic', 'logo-sm');
  // Show the default window (last 90 days) in the date pickers so it's clear
  // what's loaded and the user can widen it. Empty = server default (90 days),
  // so the initial auto-load still matches without an explicit range.
  const iso = (d) => d.toISOString().slice(0, 10);
  $('#tx-from').value = iso(new Date(Date.now() - 90 * 86400000));
  $('#tx-to').value = iso(new Date());
  $('#device-badge').hidden = !state.deviceRemembered;
  $('#forget-device-btn').hidden = !state.deviceRemembered;
  renderAccounts();
  showView('view-dashboard');
  $('#transfer-open').disabled = !state.accounts.some((a) => a.canTransfer);
  if (state.accounts[0]) selectAccount(state.accounts[0]);
}

$('#forget-device-btn').addEventListener('click', async () => {
  try {
    await api('/api/forget-device', { sessionId: state.sessionId });
    state.deviceRemembered = false;
    $('#device-badge').hidden = true;
    $('#forget-device-btn').hidden = true;
    toast('Gerät vergessen — bei der nächsten Anmeldung wird wieder eine TAN angefragt.', false, 6000);
  } catch (err) {
    toast(err.message, true);
  }
});

function renderAccounts() {
  const list = $('#account-list');
  list.innerHTML = '';
  state.accounts.forEach((a) => {
    const card = el('button', 'account-card');
    card.type = 'button';
    card.dataset.acct = a.accountNumber;
    const bal = state.balances[a.accountNumber];
    const isLoading = state.loadingAccount === a.accountNumber;
    const balHtml = bal
      ? `<div class="ac-balance num ${bal.balance < 0 ? 'neg' : ''}">${fmtMoney(bal.balance, bal.currency)}</div>`
      : `<div class="ac-balance pending">${isLoading ? 'Wird geladen …' : 'Zum Laden auswählen'}</div>`;
    card.innerHTML =
      `<div class="ac-top"><span class="ac-type">${escapeHtml(translateType(a.accountType))}</span>` +
      `<span class="ac-product" title="${escapeHtml(a.product || '')}">${escapeHtml(a.product || '')}</span></div>` +
      `<div class="ac-iban num">${fmtIban(a.iban) || escapeHtml(a.accountNumber)}</div>` +
      balHtml;
    card.addEventListener('click', () => selectAccount(a));
    if (state.activeAccount && state.activeAccount.accountNumber === a.accountNumber) card.classList.add('active');
    list.appendChild(card);
  });
}

function selectAccount(a) {
  if (state.busy) return; // don't interrupt an in-flight approval
  state.activeAccount = a;
  document.querySelectorAll('.account-card').forEach((c) => c.classList.toggle('active', c.dataset.acct === a.accountNumber));
  renderAccountHeader(a);
  loadTransactions(a);
}

function renderAccountHeader(a) {
  const bal = state.balances[a.accountNumber];
  const h = $('#account-header');
  const meta = [`<span class="num">${fmtIban(a.iban) || escapeHtml(a.accountNumber)}</span>`];
  if (a.bic) meta.push(`<span>BIC <b class="num">${escapeHtml(a.bic)}</b></span>`);
  if (bal && bal.availableAmount != null) meta.push(`<span>Verfügbar <b class="num">${fmtMoney(bal.availableAmount, bal.currency)}</b></span>`);
  if (bal && bal.date) meta.push(`<span>Stand <b class="num">${fmtDate(bal.date)}</b></span>`);

  h.innerHTML =
    `<div class="ah-toprow">` +
      `<div class="ah-label">` +
        `<span class="flabel">${escapeHtml(translateType(a.accountType))} · Kontostand</span>` +
        `<span class="ah-holder">${escapeHtml(a.holder || a.product || '')}</span>` +
      `</div>` +
      `<div class="ah-actions">` +
        (a.canTransfer ? `<button class="btn btn-primary btn-sm" id="ah-transfer">Überweisen</button>` : '') +
        `<button class="btn btn-ghost btn-sm" id="ah-reload" title="Umsätze neu laden">Aktualisieren</button>` +
      `</div>` +
    `</div>` +
    `<div class="ah-balance num ${bal && bal.balance < 0 ? 'neg' : ''}">${bal ? balanceHtml(bal.balance, bal.currency) : '—'}</div>` +
    `<div class="ah-meta">${meta.join('')}</div>`;

  const tBtn = $('#ah-transfer');
  if (tBtn) tBtn.addEventListener('click', () => openTransfer(a));
  $('#ah-reload').addEventListener('click', () => {
    delete state.txCache[a.accountNumber];
    loadTransactions(a, state.txFilter.from, state.txFilter.to);
  });
}

// Loads Umsätze (and, via the statement, the Kontostand) for one account.
async function loadTransactions(a, from, to) {
  const listEl = $('#tx-list');
  $('#tx-empty').hidden = true;
  const cacheKey = `${from || ''}|${to || ''}`;

  const cached = state.txCache[a.accountNumber];
  if (cached && cached.key === cacheKey) {
    renderAccountHeader(a);
    renderTransactions(cached.txs);
    return;
  }
  if (state.busy) return;

  state.busy = true;
  state.loadingAccount = a.accountNumber;
  renderAccounts();
  renderSkeleton();

  const finish = () => { state.busy = false; state.loadingAccount = null; };
  const apply = (txs, balance) => {
    if (balance) state.balances[a.accountNumber] = balance;
    state.txCache[a.accountNumber] = { key: cacheKey, txs: txs || [] };
    renderAccounts();
    renderAccountHeader(a);
    renderTransactions(txs || []);
  };

  try {
    const data = await api('/api/transactions', {
      sessionId: state.sessionId, accountNumber: a.accountNumber, from, to,
    });
    if (data.needsTan) {
      startDecoupledWait(decoupledMethod(), data,
        (r) => { finish(); apply(r.transactions, r.balance); },
        () => { finish(); loadTransactions(a, from, to); });
    } else {
      finish();
      apply(data.transactions, data.balance);
    }
  } catch (err) {
    finish();
    renderAccounts();
    listEl.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderSkeleton(rows = 7) {
  const listEl = $('#tx-list');
  $('#tx-empty').hidden = true;
  let html = '';
  for (let i = 0; i < rows; i++) {
    const w = 40 + ((i * 37) % 45);
    html +=
      `<div class="skel-row">` +
        `<div class="skel skel-av"></div>` +
        `<div><div class="skel skel-line" style="width:${w}%"></div>` +
        `<div class="skel skel-line" style="width:${w - 18}%;margin-top:7px"></div></div>` +
        `<div class="skel skel-line" style="width:64px;height:13px"></div>` +
      `</div>`;
  }
  listEl.innerHTML = html;
}

function currentTxs() {
  return state.activeAccount ? (state.txCache[state.activeAccount.accountNumber]?.txs || []) : [];
}

function renderTransactions(txs) {
  const listEl = $('#tx-list');
  const emptyEl = $('#tx-empty');
  const q = $('#tx-search').value.trim().toLowerCase();
  const filtered = q
    ? txs.filter((t) => (`${t.remoteName} ${t.purpose} ${t.bookingText} ${t.remoteIban}`).toLowerCase().includes(q))
    : txs.slice();

  filtered.sort((a, b) => txTime(b) - txTime(a));

  listEl.innerHTML = '';
  if (!filtered.length) { emptyEl.hidden = false; return; }
  emptyEl.hidden = true;

  let currentGroup = null;
  filtered.forEach((t) => {
    const group = groupLabel(t.entryDate || t.valueDate);
    if (group !== currentGroup) {
      currentGroup = group;
      listEl.appendChild(el('div', 'tx-group-label', escapeHtml(group)));
    }
    const credit = t.amount >= 0;
    const name = t.remoteName || t.bookingText || 'Buchung';
    const desc = t.purpose || (t.remoteName ? t.bookingText : '') || '';
    const row = el('button', 'tx');
    row.type = 'button';
    row.innerHTML =
      `<div class="tx-av ${credit ? 'credit' : ''}">${credit ? initials(name) : downSvg()}</div>` +
      `<div class="tx-main">` +
        `<div class="tx-name">${escapeHtml(name)}</div>` +
        `<div class="tx-desc">${escapeHtml(desc)}</div>` +
      `</div>` +
      `<div class="tx-right">` +
        `<div class="tx-amt num ${credit ? 'credit' : ''}">${credit ? '+' : '−'}${fmtMoney(Math.abs(t.amount), t.currency)}</div>` +
        `<div class="tx-date num">${fmtDate(t.entryDate || t.valueDate)}</div>` +
      `</div>`;
    row.addEventListener('click', () => openDetail(t));
    listEl.appendChild(row);
  });
}

const txTime = (t) => {
  const d = new Date(t.entryDate || t.valueDate || 0);
  return isNaN(d) ? 0 : d.getTime();
};

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '•';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return escapeHtml((first + last).toUpperCase());
}

const downSvg = () =>
  '<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 5v13m0 0l-5-5m5 5l5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function groupLabel(d) {
  if (!d) return 'Ohne Datum';
  const date = new Date(d);
  if (isNaN(date)) return 'Ohne Datum';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(date); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff > 1 && diff < 7) return new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(date);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}

$('#tx-search').addEventListener('input', () => {
  if (state.activeAccount) renderTransactions(currentTxs());
});
$('#tx-reload').addEventListener('click', () => {
  if (!state.activeAccount) return;
  state.txFilter.from = $('#tx-from').value || undefined;
  state.txFilter.to = $('#tx-to').value || undefined;
  loadTransactions(state.activeAccount, state.txFilter.from, state.txFilter.to);
});

// ---------------------------------------------------------------------------
// TRANSACTION DETAIL
// ---------------------------------------------------------------------------
function openDetail(t) {
  const credit = t.amount >= 0;
  const rows = [
    ['Empfänger / Auftraggeber', t.remoteName],
    ['IBAN / Konto', t.remoteIban ? fmtIban(t.remoteIban) : '', true],
    ['BIC', t.remoteBic, true],
    ['Verwendungszweck', t.purpose, true],
    ['Buchungstag', fmtDate(t.entryDate)],
    ['Wertstellung', fmtDate(t.valueDate)],
    ['Buchungstext', t.bookingText],
    ['End-to-End-Referenz', t.e2eReference, true],
    ['Mandatsreferenz', t.mandateReference, true],
    ['Kundenreferenz', t.customerReference !== 'NONREF' ? t.customerReference : ''],
    ['Bankreferenz', t.bankReference],
    ['Geschäftsvorfallcode', t.transactionCode],
    ['Primanota', t.primeNotesNr],
    ['Auszug Nr.', t.statementNumber],
    ['Zusatzinformation', t.additionalInformation],
  ].filter(([, v]) => v);

  $('#detail-body').innerHTML =
    `<div class="dt-amount num ${credit ? 'credit' : ''}">${credit ? '+' : '−'}${fmtMoney(Math.abs(t.amount), t.currency)}</div>` +
    `<div class="dt-name">${escapeHtml(t.remoteName || t.bookingText || 'Buchung')}</div>` +
    `<div class="dt-booking">${escapeHtml(t.bookingText || '')}</div>` +
    `<dl class="dt-rows">` +
    rows.map(([label, value, copy]) =>
      `<div class="dt-row"><dt>${escapeHtml(label)}</dt>` +
      `<dd><span style="min-width:0">${escapeHtml(value)}</span>` +
      (copy ? `<button class="dt-copy" data-copy="${escapeHtml(value)}" title="Kopieren" aria-label="${escapeHtml(label)} kopieren">` +
        `<svg viewBox="0 0 24 24" width="14" height="14"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>` : '') +
      `</dd></div>`,
    ).join('') +
    `</dl>`;

  $('#detail-body').querySelectorAll('.dt-copy').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy.replace(/\s+/g, ' '));
        toast('Kopiert');
      } catch { toast('Kopieren nicht möglich', true); }
    });
  });

  openOverlay('ov-detail');
}
$('#detail-close').addEventListener('click', () => closeOverlay('ov-detail'));
$('#ov-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay('ov-detail'); });

// ---------------------------------------------------------------------------
// TRANSFER (Überweisung)
// ---------------------------------------------------------------------------
function ibanValid(input) {
  const iban = String(input || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('DE') && iban.length !== 22) return false;
  const re = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const v = ch >= '0' && ch <= '9' ? ch : (ch.charCodeAt(0) - 55).toString();
    for (const d of v) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

let transferInstant = false;

function openTransfer(preselect) {
  const eligible = state.accounts.filter((a) => a.canTransfer);
  if (!eligible.length) { toast('Kein Konto unterstützt Überweisungen über FinTS.', true); return; }

  const sel = $('#tf-account');
  sel.innerHTML = '';
  eligible.forEach((a) => {
    const o = el('option');
    o.value = a.accountNumber;
    o.textContent = `${translateType(a.accountType)} · ${fmtIban(a.iban)}`;
    sel.appendChild(o);
  });
  if (preselect && eligible.some((a) => a.accountNumber === preselect.accountNumber)) {
    sel.value = preselect.accountNumber;
  }

  $('#transfer-form').hidden = false;
  $('#transfer-review').hidden = true;
  $('#transfer-result').hidden = true;
  resetTransferForm();
  showError('#transfer-error', null);
  showError('#review-error', null);
  transferInstant = false;
  syncTransferMode();
  openOverlay('ov-transfer');
  $('#tf-name').focus();
}

function resetTransferForm() {
  $('#tf-name').value = '';
  $('#tf-iban').value = '';
  $('#tf-iban').classList.remove('invalid');
  $('#tf-iban-hint').textContent = '';
  $('#tf-iban-hint').className = 'fhint';
  $('#tf-amount').value = '';
  $('#tf-purpose').value = '';
  $('#tf-purpose-count').textContent = '0/140';
}

function selectedTransferAccount() {
  return state.accounts.find((a) => a.accountNumber === $('#tf-account').value);
}

function syncTransferMode() {
  const a = selectedTransferAccount();
  const canInstant = !!a?.canInstant;
  if (!canInstant) transferInstant = false;
  $('#tf-mode-instant').disabled = !canInstant;
  $('#tf-mode-std').classList.toggle('on', !transferInstant);
  $('#tf-mode-instant').classList.toggle('on', transferInstant);
  const note = $('#tf-mode-note');
  if (!canInstant) {
    note.textContent = 'Echtzeitüberweisung wird für dieses Konto nicht über FinTS angeboten.';
    note.hidden = false;
  } else if (transferInstant) {
    note.textContent = 'Der Betrag ist in Sekunden beim Empfänger. Ausführung rund um die Uhr.';
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

$('#tf-account').addEventListener('change', syncTransferMode);
$('#tf-mode-std').addEventListener('click', () => { transferInstant = false; syncTransferMode(); });
$('#tf-mode-instant').addEventListener('click', () => { transferInstant = true; syncTransferMode(); });

$('#tf-iban').addEventListener('input', (e) => {
  const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  e.target.value = raw.replace(/(.{4})/g, '$1 ').trim();
  const hint = $('#tf-iban-hint');
  if (raw.length < 15) {
    e.target.classList.remove('invalid');
    hint.textContent = ''; hint.className = 'fhint';
  } else if (ibanValid(raw)) {
    e.target.classList.remove('invalid');
    hint.textContent = 'IBAN geprüft ✓'; hint.className = 'fhint ok';
  } else {
    e.target.classList.add('invalid');
    hint.textContent = 'IBAN ist ungültig'; hint.className = 'fhint bad';
  }
});

$('#tf-purpose').addEventListener('input', (e) => {
  $('#tf-purpose-count').textContent = `${e.target.value.length}/140`;
});

$('#transfer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  showError('#transfer-error', null);

  const account = selectedTransferAccount();
  const name = $('#tf-name').value.trim();
  const iban = $('#tf-iban').value.replace(/\s+/g, '').toUpperCase();
  const amountRaw = $('#tf-amount').value.trim();
  const purpose = $('#tf-purpose').value.trim();

  if (!account) return showError('#transfer-error', 'Bitte ein Konto wählen.');
  if (!name) return showError('#transfer-error', 'Bitte den Empfänger angeben.');
  if (!ibanValid(iban)) return showError('#transfer-error', 'Die IBAN ist ungültig.');
  const norm = amountRaw.replace(/\./g, '').replace(',', '.');
  const amountNum = parseFloat(norm);
  if (!/^\d+(\.\d{1,2})?$/.test(norm) || !(amountNum > 0)) {
    return showError('#transfer-error', 'Bitte einen gültigen Betrag angeben, z. B. 25,00.');
  }
  if (iban === (account.iban || '').toUpperCase()) {
    return showError('#transfer-error', 'Empfänger-IBAN und eigenes Konto sind identisch.');
  }

  state.transferDraft = { account, name, iban, amount: amountRaw, amountNum, purpose, instant: transferInstant };
  renderTransferReview();
});

function renderTransferReview() {
  const d = state.transferDraft;
  $('#review-rows').innerHTML = [
    ['Von', `${translateType(d.account.accountType)} · <span class="num">${fmtIban(d.account.iban)}</span>`],
    ['An', escapeHtml(d.name)],
    ['IBAN', `<span class="num">${fmtIban(d.iban)}</span>`],
    d.purpose ? ['Verwendungszweck', escapeHtml(d.purpose)] : null,
    ['Art', d.instant ? '⚡ Echtzeitüberweisung' : 'SEPA-Überweisung'],
    ['Betrag', `<span class="num">${fmtMoney(d.amountNum)}</span>`, true],
  ].filter(Boolean).map(([label, value, hero]) =>
    `<div class="review-row ${hero ? 'hero' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`,
  ).join('');

  $('#transfer-form').hidden = true;
  $('#transfer-review').hidden = false;
  showError('#review-error', null);
}

$('#review-back').addEventListener('click', () => {
  $('#transfer-review').hidden = true;
  $('#transfer-form').hidden = false;
});

$('#review-submit').addEventListener('click', async () => {
  const d = state.transferDraft;
  if (!d || state.busy) return;
  const btn = $('#review-submit');
  btn.disabled = true;
  btn.querySelector('.spinner').hidden = false;
  showError('#review-error', null);
  state.busy = true;

  try {
    const data = await api('/api/transfer', {
      sessionId: state.sessionId,
      accountNumber: d.account.accountNumber,
      recipientName: d.name,
      iban: d.iban,
      amount: d.amount,
      purpose: d.purpose,
      instant: d.instant,
    });

    if (data.needsTan) {
      closeOverlay('ov-transfer');
      startDecoupledWait(decoupledMethod(), data,
        (r) => { state.busy = false; showTransferResult(true, r.bankAnswers); },
        null,
        {
          title: 'Überweisung freigeben',
          onDialogEnded: () => {
            state.busy = false;
            closeOverlay('ov-tanwait');
            showTransferResult('unknown');
          },
        });
    } else {
      state.busy = false;
      showTransferResult(true, data.bankAnswers);
    }
  } catch (err) {
    state.busy = false;
    showError('#review-error', err.message);
  } finally {
    btn.disabled = false;
    btn.querySelector('.spinner').hidden = true;
  }
});

function showTransferResult(ok, bankAnswers) {
  const d = state.transferDraft;
  const box = $('#transfer-result');
  const okIcon = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const warnIcon = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 5v8m0 4.2v.3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  if (ok === true) {
    box.innerHTML =
      `<div style="text-align:center">` +
      `<div class="result-icon">${okIcon}</div>` +
      `<h3 class="sheet-title">Überweisung ausgeführt</h3>` +
      `<p class="auth-lead">${fmtMoney(d.amountNum)} an ${escapeHtml(d.name)}${d.instant ? ' · in Echtzeit' : ''}.</p>` +
      (bankAnswers ? `<p class="fhint" style="margin-bottom:14px">${escapeHtml(bankAnswers)}</p>` : '') +
      `<button class="btn btn-primary btn-block" id="result-done">Fertig</button>` +
      `</div>`;
  } else {
    box.innerHTML =
      `<div style="text-align:center">` +
      `<div class="result-icon warn">${warnIcon}</div>` +
      `<h3 class="sheet-title">Status unklar</h3>` +
      `<p class="auth-lead">Die Bank hat die Verbindung beendet, bevor die Freigabe bestätigt wurde. ` +
      `Die Überweisung wurde möglicherweise trotzdem ausgeführt — bitte prüfe die Umsätze, ` +
      `bevor du sie erneut sendest.</p>` +
      `<button class="btn btn-primary btn-block" id="result-done">Umsätze prüfen</button>` +
      `</div>`;
  }

  $('#transfer-form').hidden = true;
  $('#transfer-review').hidden = true;
  box.hidden = false;
  openOverlay('ov-transfer');

  $('#result-done').addEventListener('click', () => {
    closeOverlay('ov-transfer');
    // fresh statement fetch shows the new booking
    const acct = state.accounts.find((a) => a.accountNumber === d.account.accountNumber);
    if (acct) {
      delete state.txCache[acct.accountNumber];
      selectAccount(acct);
    }
  });
}

$('#transfer-open').addEventListener('click', () => openTransfer(state.activeAccount));
$('#transfer-close').addEventListener('click', () => closeOverlay('ov-transfer'));

// ---------------------------------------------------------------------------
// Logout + utils
// ---------------------------------------------------------------------------
$('#logout-btn').addEventListener('click', async () => {
  clearTimeout(state.pollTimer);
  try { await api('/api/logout', { sessionId: state.sessionId }); } catch {}
  // Logout clears the session only; the remembered device stays (use
  // "Gerät vergessen" to wipe it).
  Object.assign(state, {
    sessionId: null, accounts: [], balances: {}, txCache: {}, activeAccount: null,
    selectedMethod: null, busy: false, loadingAccount: null, transferDraft: null,
    txFilter: { from: undefined, to: undefined }, deviceRemembered: false,
  });
  $('#tx-list').innerHTML = '';
  $('#tx-search').value = '';
  $('#tx-from').value = '';
  $('#tx-to').value = '';
  showView('view-login');
});

function translateType(t) {
  const map = {
    CheckingAccount: 'Girokonto', SavingsAccount: 'Sparkonto',
    FixedDepositAccount: 'Festgeld', SecuritiesAccount: 'Depot',
    LoanMortgageAccount: 'Kredit', CreditCardAccount: 'Kreditkarte',
    HomeSavingsContract: 'Bausparvertrag', InsurancePolicy: 'Versicherung',
    InvestmentCompanyFund: 'Fonds', Miscellaneous: 'Konto',
  };
  return map[t] || 'Konto';
}

// boot
boot();
