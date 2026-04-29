'use strict';

// ═══════════════════════════════════════════
// KAIZO MARKETS — FRONTEND APPLICATION
// ═══════════════════════════════════════════

const App = (() => {

  const SYMBOLS = ['UK100', 'DE30', 'XAUUSD', 'USOIL'];
  const SYMBOL_NAMES = { UK100:'FTSE 100', DE30:'DAX 40', XAUUSD:'Gold (XAU/USD)', USOIL:'US Crude Oil' };
  const DEFAULT_RANGE = 365;

  let token   = null;
  let user    = null;
  let vapidKey = null;

  // ════════════════
  // AUTH
  // ════════════════
  async function init() {
    token = localStorage.getItem('km_token');
    user  = JSON.parse(localStorage.getItem('km_user') || 'null');

    if (token && user) {
      // Verify token still valid
      try {
        const me = await api('/api/auth/me');
        user = me;
        showApp();
      } catch {
        logout(false);
      }
    }

    setupLoginForm();
    registerServiceWorker();
    setupInstallPrompt();
    updateDate();
    setInterval(updateDate, 60000);

    // Handle navigation messages from SW
    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type === 'NAVIGATE') navTo(e.data.url === '/reports' ? 'reports' : 'reports');
    });
  }

  function setupLoginForm() {
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn      = document.getElementById('login-btn');
      const errEl    = document.getElementById('login-error');
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      btn.disabled   = true;
      btn.textContent = 'Signing in...';
      errEl.style.display = 'none';

      try {
        const data = await api('/api/auth/login', 'POST', { username, password }, false);
        token = data.token;
        user  = data.user;
        localStorage.setItem('km_token', token);
        localStorage.setItem('km_user', JSON.stringify(user));
        showApp();
      } catch (err) {
        errEl.textContent   = err.message || 'Invalid credentials';
        errEl.style.display = 'block';
        btn.disabled        = false;
        btn.textContent     = 'Sign In';
      }
    });
  }

  function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('user-chip').textContent = user.display_name || user.username;

    setupNav();
    setupLogout();
    setupSettings();
    loadReports();
    checkEAStatus();
    setInterval(checkEAStatus, 60000);
    fetchVapidKey();
  }

  function logout(redirect = true) {
    token = null;
    user  = null;
    localStorage.removeItem('km_token');
    localStorage.removeItem('km_user');
    if (redirect) {
      document.getElementById('app').style.display   = 'none';
      document.getElementById('login-screen').style.display = 'flex';
    }
  }

  // ════════════════
  // NAVIGATION
  // ════════════════
  function setupNav() {
    document.querySelectorAll('.nav-a[data-page]').forEach(el => {
      el.addEventListener('click', function () {
        navTo(this.dataset.page);
      });
    });
  }

  function navTo(pageId) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-a').forEach(n => n.classList.remove('active'));

    const page    = document.getElementById(`page-${pageId}`);
    const navLink = document.querySelector(`.nav-a[data-page="${pageId}"]`);

    if (page) page.classList.add('active');
    if (navLink) navLink.classList.add('active');

    // Update topbar
    const meta = getPageMeta(pageId);
    document.getElementById('tb-title').textContent = meta.title;
    document.getElementById('tb-desc').textContent  = meta.desc;

    // Load chart if navigating to a chart page
    if (pageId.startsWith('chart-')) {
      const symbol = pageId.replace('chart-', '');
      loadChart(symbol);
    }

    closeSidebar();
    window.scrollTo(0, 0);
  }

  function getPageMeta(pageId) {
    const map = {
      reports: { title: 'Daily Reports', desc: 'Latest candle analysis · All symbols' },
      settings: { title: 'Settings', desc: 'Notifications · Account · Data status' },
    };
    if (pageId.startsWith('chart-')) {
      const sym = pageId.replace('chart-', '');
      return { title: SYMBOL_NAMES[sym] || sym, desc: 'Daily candlestick chart' };
    }
    return map[pageId] || { title: pageId, desc: '' };
  }

  // Hamburger
  document.getElementById('hbtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('open');
  });
  document.getElementById('overlay').addEventListener('click', closeSidebar);

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
  }

  // ════════════════
  // REPORTS PAGE
  // ════════════════
  async function loadReports() {
    const loading = document.getElementById('reports-loading');
    const content = document.getElementById('reports-content');
    const empty   = document.getElementById('reports-empty');

    loading.style.display = 'flex';
    content.style.display = 'none';
    empty.style.display   = 'none';

    try {
      const reports = await api('/api/reports/latest');

      if (!reports || reports.length === 0) {
        loading.style.display = 'none';
        empty.style.display   = 'flex';
        return;
      }

      const grid = document.getElementById('reports-grid');
      grid.innerHTML = '';

      reports.forEach(r => {
        grid.appendChild(buildReportCard(r));
      });

      // Update close prices in nav
      reports.forEach(r => {
        const el = document.getElementById(`close-${r.symbol}`);
        if (el) el.textContent = fmtPrice(r.close, r.symbol);
      });

      loading.style.display = 'none';
      content.style.display = 'block';
    } catch (err) {
      loading.style.display = 'none';
      empty.style.display   = 'flex';
      console.error('Failed to load reports:', err);
    }
  }

  function buildReportCard(r) {
    const bias    = r.bias || 'neutral';
    const pattern = (r.candle_type || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const levels  = typeof r.key_levels === 'string' ? JSON.parse(r.key_levels) : r.key_levels || {};
    const symName = SYMBOL_NAMES[r.symbol] || r.symbol;
    const date    = new Date(r.report_date);
    const dateStr = date.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    const genTime = new Date(r.generated_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });

    // Candle body proportions
    const range     = (levels.high || 0) - (levels.low || 0);
    const bodySize  = (levels.body_high || 0) - (levels.body_low || 0);
    const bodyPct   = range > 0 ? (bodySize / range) * 100 : 30;
    const topWickPct = range > 0 ? ((levels.high - (levels.body_high || levels.high)) / range) * 100 : 20;
    const botWickPct = range > 0 ? (((levels.body_low || levels.low) - levels.low) / range) * 100 : 20;

    const bodyH   = Math.max(6, Math.round(bodyPct * 0.7));
    const topW    = Math.max(4, Math.round(topWickPct * 0.7));
    const botW    = Math.max(4, Math.round(botWickPct * 0.7));

    // Key level bar positions
    const closePos = range > 0 ? (((levels.close || 0) - (levels.low || 0)) / range) * 100 : 50;

    // Bias emoji
    const biasEmoji = { bullish: '▲', bearish: '▼', neutral: '↔' }[bias] || '↔';
    const confText  = r.bias_confidence ? `${r.bias_confidence}% confidence` : '';

    // Report narrative (first 200 chars)
    const narrative = (r.report_text || '')
      .split('\n').filter(l => !l.startsWith('CANDLE:') && !l.startsWith('BIAS:')
        && !l.startsWith('STRUCTURE:') && !l.startsWith('KEY LEVELS')
        && !l.startsWith('HISTORICAL') && !l.startsWith('ANALYSIS')
        && !l.startsWith(symName) && l.trim() !== r.symbol
        && !l.match(/^[A-Z]+:/) && l.trim().length > 20)
      .join(' ').trim().slice(0, 280) + '...';

    const card = document.createElement('div');
    card.className = 'report-card';
    card.innerHTML = `
      <div class="rc-head">
        <div>
          <div class="rc-sym">${r.symbol}</div>
          <span class="rc-full">${symName}</span>
        </div>
        <div class="rc-bias ${bias}">${biasEmoji} ${bias.charAt(0).toUpperCase()+bias.slice(1)}</div>
      </div>
      <div class="rc-body">
        <div class="candle-vis-row">
          <div class="cv-wrap">
            <div class="cv-wick" style="height:${topW}px"></div>
            <div class="cv-body ${bias}" style="height:${bodyH}px"></div>
            <div class="cv-wick" style="height:${botW}px"></div>
          </div>
          <div class="cv-meta">
            <h4>${pattern}</h4>
            <p>${r.structure_label ? r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1) + ' · ' : ''}${confText}</p>
          </div>
        </div>
        <div class="ohlc-grid">
          <div class="ohlc-item"><div class="ohlc-l">Open</div><div class="ohlc-v">${fmtPrice(levels.open, r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">High</div><div class="ohlc-v bearish">${fmtPrice(levels.high, r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">Low</div><div class="ohlc-v bullish">${fmtPrice(levels.low, r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">Close</div><div class="ohlc-v ${bias}">${fmtPrice(levels.close, r.symbol)}</div></div>
          <div class="ohlc-item" style="border-color:rgba(201,168,76,.2);background:rgba(201,168,76,.05)"><div class="ohlc-l" style="color:var(--go)">Body High</div><div class="ohlc-v gold">${fmtPrice(levels.body_high, r.symbol)}</div></div>
          <div class="ohlc-item" style="border-color:rgba(201,168,76,.2);background:rgba(201,168,76,.05)"><div class="ohlc-l" style="color:var(--go)">Body Low</div><div class="ohlc-v gold">${fmtPrice(levels.body_low, r.symbol)}</div></div>
        </div>
        <div class="key-levels">
          <div class="kl-title">Session Range</div>
          <div class="kl-row"><div class="kl-lbl">High</div><div class="kl-bar-wrap"><div class="kl-bar high" style="width:90%"></div></div><div class="kl-price">${fmtPrice(levels.high, r.symbol)}</div></div>
          <div class="kl-row"><div class="kl-lbl">Close</div><div class="kl-bar-wrap"><div class="kl-bar close" style="width:${Math.round(closePos)}%"></div></div><div class="kl-price">${fmtPrice(levels.close, r.symbol)}</div></div>
          <div class="kl-row"><div class="kl-lbl">Low</div><div class="kl-bar-wrap"><div class="kl-bar low" style="width:10%"></div></div><div class="kl-price">${fmtPrice(levels.low, r.symbol)}</div></div>
        </div>
        <div class="report-text-wrap">
          <div class="rt-label">Analysis</div>
          <div class="rt-text">${narrative || r.short_summary || 'Report available — tap to read full analysis.'}</div>
        </div>
      </div>
      <div class="rc-footer">
        <span class="rc-ts">${dateStr} · Generated ${genTime} UTC</span>
        ${r.structure_label ? `<span class="rc-struct ${r.structure_label}">${r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)}</span>` : ''}
      </div>`;

    return card;
  }

  // ════════════════
  // CHARTS
  // ════════════════
  const chartInitialised = {};
  const chartData = {};

  async function loadChart(symbol) {
    if (chartInitialised[symbol]) return;

    const page = document.getElementById(`page-chart-${symbol}`);
    if (!page) return;

    const chartPage = page.querySelector('.chart-page');
    chartPage.innerHTML = `
      <div class="chart-toolbar">
        <div>
          <div class="chart-sym-title">${symbol}</div>
          <div style="font-size:11.5px;color:var(--tx2)">${SYMBOL_NAMES[symbol]}</div>
        </div>
        <div id="chart-ohlc-${symbol}" style="display:flex;gap:14px;font-family:var(--fm);font-size:11px;color:var(--tx2);align-items:center"></div>
        <div class="chart-range-btns">
          ${['1M','3M','6M','1Y','2Y','ALL'].map(r =>
            `<button class="range-btn${r==='1Y'?' active':''}" data-range="${r}" data-sym="${symbol}">${r}</button>`
          ).join('')}
        </div>
      </div>
      <div id="chart-container-${symbol}" style="flex:1;border-radius:var(--r2);overflow:hidden;background:var(--sf);border:1px solid var(--bd)"></div>
      <div id="chart-tooltip-${symbol}" style="display:none;gap:14px;padding-top:10px;font-family:var(--fm);font-size:11px;color:var(--tx2)"></div>`;

    // Range buttons
    page.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        page.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const days = { '1M':30,'3M':90,'6M':180,'1Y':365,'2Y':730,'ALL':9999 }[this.dataset.range];
        KaizokuCharts.setRange(symbol, days);
      });
    });

    // Load data
    try {
      const res = await api(`/api/candles/${symbol}?limit=5000`);
      chartData[symbol] = res.candles;
      KaizokuCharts.initChart(symbol, `chart-container-${symbol}`, res.candles);
      chartInitialised[symbol] = true;
    } catch (err) {
      chartPage.innerHTML += `<div class="empty-state"><div class="empty-icon">◫</div><h3>No chart data</h3><p>The EA has not sent any data for ${symbol} yet.</p></div>`;
    }
  }

  // ════════════════
  // EA STATUS
  // ════════════════
  async function checkEAStatus() {
    try {
      const res = await api('/api/candles/', 'GET', null, true, 5000);
      const dot  = document.getElementById('ea-dot');
      const text = document.getElementById('ea-status-text');
      const sync = document.getElementById('ea-last-sync');

      if (res && res.length > 0) {
        dot.className    = 'ea-dot connected';
        text.textContent = 'EA Connected';
        const latest = res.sort((a, b) => new Date(b.to_date) - new Date(a.to_date))[0];
        sync.textContent = `Last: ${new Date(latest.to_date).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}`;
      } else {
        dot.className    = 'ea-dot error';
        text.textContent = 'No data yet';
        sync.textContent = 'EA not connected';
      }
    } catch {
      document.getElementById('ea-dot').className       = 'ea-dot error';
      document.getElementById('ea-status-text').textContent = 'Connection error';
    }
  }

  // ════════════════
  // PUSH NOTIFICATIONS
  // ════════════════
  async function fetchVapidKey() {
    try {
      const res = await api('/api/push/vapid-public-key', 'GET', null, false);
      vapidKey = res.key;
      updateNotifUI();
    } catch { /* VAPID not configured */ }
  }

  async function subscribeNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Push notifications are not supported in this browser.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        updateNotifUI('denied');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      await api('/api/push/subscribe', 'POST', {
        subscription:  sub.toJSON(),
        device_label:  navigator.platform || 'Browser',
      });

      updateNotifUI('subscribed');
    } catch (err) {
      console.error('Subscribe error:', err);
      alert('Could not enable notifications: ' + err.message);
    }
  }

  async function unsubscribeNotifications() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api('/api/push/unsubscribe', 'POST', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      updateNotifUI('unsubscribed');
    } catch (err) {
      console.error('Unsubscribe error:', err);
    }
  }

  async function updateNotifUI(state = null) {
    const statusBox = document.getElementById('notif-status-box');
    const btn       = document.getElementById('notif-toggle-btn');
    if (!statusBox || !btn) return;

    if (!('Notification' in window)) {
      statusBox.textContent = 'Notifications not supported in this browser.';
      btn.style.display = 'none';
      return;
    }

    if (!vapidKey) {
      statusBox.textContent = 'Push notifications not yet configured on server.';
      btn.style.display = 'none';
      return;
    }

    const reg = await navigator.serviceWorker?.ready;
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const perm = Notification.permission;

    if (sub || state === 'subscribed') {
      statusBox.textContent = '✓ Notifications enabled — you will receive daily reports.';
      btn.textContent = 'Disable Notifications';
      btn.onclick = unsubscribeNotifications;
    } else if (perm === 'denied' || state === 'denied') {
      statusBox.textContent = 'Notifications blocked. Please enable them in your browser settings.';
      btn.style.display = 'none';
    } else {
      statusBox.textContent = 'Not yet enabled — click below to receive daily report alerts.';
      btn.textContent = 'Enable Notifications';
      btn.onclick = subscribeNotifications;
    }
  }

  // ════════════════
  // SETTINGS
  // ════════════════
  function setupLogout() {
    document.getElementById('logout-btn').addEventListener('click', () => {
      if (confirm('Sign out?')) logout();
    });
  }

  function setupSettings() {
    // Password form
    document.getElementById('pw-form').addEventListener('submit', async e => {
      e.preventDefault();
      const msgEl   = document.getElementById('pw-msg');
      const current = document.getElementById('pw-current').value;
      const next    = document.getElementById('pw-new').value;

      msgEl.style.display = 'none';
      try {
        await api('/api/auth/change-password', 'POST', {
          current_password: current,
          new_password: next,
        });
        msgEl.className      = 'form-msg success';
        msgEl.textContent    = '✓ Password updated successfully.';
        msgEl.style.display  = 'block';
        document.getElementById('pw-current').value = '';
        document.getElementById('pw-new').value     = '';
      } catch (err) {
        msgEl.className      = 'form-msg error';
        msgEl.textContent    = err.message || 'Failed to update password.';
        msgEl.style.display  = 'block';
      }
    });

    // Notif button in topbar
    document.getElementById('notif-btn').addEventListener('click', () => {
      navTo('settings');
    });

    // Load data status
    loadDataStatus();
  }

  async function loadDataStatus() {
    try {
      const res = await api('/api/candles/');
      const grid = document.getElementById('data-status');
      if (!grid) return;

      if (!res || res.length === 0) {
        grid.innerHTML = '<p style="font-size:13px;color:var(--tx3)">No data received yet.</p>';
        return;
      }

      grid.innerHTML = res.map(s => `
        <div class="ds-row">
          <span class="ds-sym">${s.symbol}</span>
          <span class="ds-info">${s.total_candles} candles · Latest: ${new Date(s.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
        </div>`).join('');
    } catch { /* ignore */ }
  }

  // ════════════════
  // PWA INSTALL
  // ════════════════
  let deferredPrompt = null;

  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      const btn = document.getElementById('install-btn');
      if (btn) btn.style.display = 'block';
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      const btn  = document.getElementById('install-btn');
      const note = document.getElementById('install-note');
      if (btn) btn.style.display = 'none';
      if (note) {
        note.textContent   = '✓ App installed successfully.';
        note.style.display = 'block';
      }
    });

    const installBtn = document.getElementById('install-btn');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      });
    }

    // iOS Safari instructions
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
      const note = document.getElementById('install-note');
      if (note) {
        note.textContent   = 'On iPhone/iPad: tap the Share button → Add to Home Screen.';
        note.style.display = 'block';
      }
    }
  }

  // ════════════════
  // SERVICE WORKER
  // ════════════════
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('SW registered:', reg.scope);
      }).catch(err => {
        console.warn('SW registration failed:', err);
      });
    }
  }

  // ════════════════
  // UTILITIES
  // ════════════════
  function updateDate() {
    const el = document.getElementById('tb-date');
    if (el) {
      el.textContent = new Date().toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
    }
  }

  async function api(path, method = 'GET', body = null, auth = true, timeout = 10000) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(path, {
        method,
        headers,
        body:   body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 401 || res.status === 403) {
        if (auth) logout();
        throw new Error('Unauthorised');
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out');
      throw err;
    }
  }

  function fmtPrice(v, symbol) {
    if (!v) return '—';
    const n = +v;
    if (symbol === 'XAUUSD') return n.toFixed(2);
    if (symbol === 'USOIL')  return n.toFixed(3);
    return n >= 1000 ? n.toFixed(2) : n.toFixed(4);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
