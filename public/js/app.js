'use strict';
// ═══════════════════════════════════════════════════════════════
// KAIZOKU REPORTS — FRONTEND APP
// ═══════════════════════════════════════════════════════════════

const App = (() => {
  const SYMBOLS      = ['UK100','DE30','XAUUSD','USOIL'];
  const SYMBOL_NAMES = { UK100:'FTSE 100', DE30:'DAX 40', XAUUSD:'Gold (XAU/USD)', USOIL:'US Crude Oil' };

  let token        = null;
  let user         = null;
  let vapidKey     = null;
  let reportDate   = null; // currently viewed report date (null = latest)
  let allReportDates = {}; // symbol -> array of available dates

  // ────────────────────────────────────────────────────────────
  // INIT
  // ────────────────────────────────────────────────────────────
  async function init() {
    token = localStorage.getItem('km_token');
    user  = JSON.parse(localStorage.getItem('km_user') || 'null');

    // Check if setup is required (no users exist yet)
    try {
      const s = await api('/api/setup/status', 'GET', null, false);
      if (s.setup_required) { showSetupScreen(); return; }
    } catch { /* server might be unreachable — try login anyway */ }

    if (token && user) {
      try { user = await api('/api/auth/me'); showApp(); }
      catch { logout(false); }
    }

    setupLoginForm();
    registerServiceWorker();
    setupInstallPrompt();
    updateDate();
    setInterval(updateDate, 60000);

    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type === 'NAVIGATE') navTo('reports');
    });
  }

  // ────────────────────────────────────────────────────────────
  // SETUP SCREEN (first run — no users exist)
  // ────────────────────────────────────────────────────────────
  function showSetupScreen() {
    document.getElementById('login-screen').style.display  = 'none';
    document.getElementById('app').style.display           = 'none';
    document.getElementById('setup-screen').style.display  = 'flex';
    setupSetupForm();
  }

  function setupSetupForm() {
    document.getElementById('setup-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn    = document.getElementById('setup-submit-btn');
      const errEl  = document.getElementById('setup-error');
      errEl.style.display = 'none';
      btn.disabled = true; btn.textContent = 'Creating accounts...';

      const users = [];
      for (let i = 1; i <= 4; i++) {
        const uname = document.getElementById(`su${i}-username`)?.value.trim();
        const pass  = document.getElementById(`su${i}-password`)?.value;
        const dname = document.getElementById(`su${i}-display`)?.value.trim();
        const email = document.getElementById(`su${i}-email`)?.value.trim() || null;
        if (!uname && !pass) continue;
        if (!uname || !pass || pass.length < 8) {
          showSetupError(i === 1 ? 'Admin username and password (min 8 chars) are required.' : `Fill in both username and password for User ${i} (min 8 chars).`);
          btn.disabled = false; btn.textContent = 'Create Accounts & Launch'; return;
        }
        users.push({ username: uname, password: pass, display_name: dname || uname, email });
      }
      if (users.length === 0) { showSetupError('Add at least one user.'); btn.disabled = false; btn.textContent = 'Create Accounts & Launch'; return; }

      try {
        const data = await api('/api/setup', 'POST', { users }, false);
        // Show EA key then auto-login as first user
        document.getElementById('setup-ea-key').textContent = data.ea_key;
        document.getElementById('setup-success').style.display = 'block';
        document.getElementById('setup-form-wrap').style.display = 'none';
        // Store EA key display, let admin log in
        document.getElementById('setup-goto-login').addEventListener('click', () => {
          document.getElementById('setup-screen').style.display = 'none';
          document.getElementById('login-screen').style.display = 'flex';
          setupLoginForm();
        });
      } catch (err) {
        showSetupError(err.message || 'Setup failed.');
        btn.disabled = false; btn.textContent = 'Create Accounts & Launch';
      }
    });
  }

  function showSetupError(msg) {
    const el = document.getElementById('setup-error');
    el.textContent = msg; el.style.display = 'block';
  }

  // ────────────────────────────────────────────────────────────
  // AUTH
  // ────────────────────────────────────────────────────────────
  function setupLoginForm() {
    const form = document.getElementById('login-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn    = document.getElementById('login-btn');
      const errEl  = document.getElementById('login-error');
      btn.disabled = true; btn.textContent = 'Signing in...';
      errEl.style.display = 'none';
      try {
        const data = await api('/api/auth/login', 'POST', {
          login: document.getElementById('login-field').value.trim(),
          password: document.getElementById('password').value,
        }, false);
        token = data.token; user = data.user;
        localStorage.setItem('km_token', token);
        localStorage.setItem('km_user', JSON.stringify(user));
        showApp();
      } catch (err) {
        errEl.textContent = err.message || 'Invalid credentials';
        errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Sign In';
      }
    });
  }

  function showApp() {
    document.getElementById('login-screen').style.display  = 'none';
    document.getElementById('setup-screen').style.display  = 'none';
    document.getElementById('app').style.display           = 'flex';
    document.getElementById('user-chip').textContent       = user.display_name || user.username;

    // Show admin-only nav item
    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = user.role === 'admin' ? 'flex' : 'none';

    setupNav();
    setupLogout();
    setupSettings();
    loadReports(null);
    checkEAStatus();
    setInterval(checkEAStatus, 90000);
    fetchVapidKey();
  }

  function logout(redirect = true) {
    token = null; user = null;
    localStorage.removeItem('km_token');
    localStorage.removeItem('km_user');
    if (redirect) {
      document.getElementById('app').style.display          = 'none';
      document.getElementById('login-screen').style.display = 'flex';
    }
  }

  // ────────────────────────────────────────────────────────────
  // NAVIGATION
  // ────────────────────────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll('.nav-a[data-page]').forEach(el => {
      el.addEventListener('click', function() { navTo(this.dataset.page); });
    });
  }

  const PAGE_META = {
    reports:        { title:'Daily Reports',           desc:'Candle analysis · All symbols' },
    'chart-UK100':  { title:'UK100 — FTSE 100',        desc:'Daily candlestick chart' },
    'chart-DE30':   { title:'DE30 — DAX 40',           desc:'Daily candlestick chart' },
    'chart-XAUUSD': { title:'XAUUSD — Gold',           desc:'Daily candlestick chart' },
    'chart-USOIL':  { title:'USOIL — US Crude Oil',    desc:'Daily candlestick chart' },
    settings:       { title:'Settings',                desc:'Profile · Notifications · Install' },
    admin:          { title:'Admin Panel',             desc:'Users · EA Key · System' },
  };

  function navTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-a').forEach(n => n.classList.remove('active'));
    const page = document.getElementById(`page-${pageId}`);
    if (page) page.classList.add('active');
    document.querySelector(`.nav-a[data-page="${pageId}"]`)?.classList.add('active');
    const m = PAGE_META[pageId] || { title: pageId, desc: '' };
    document.getElementById('tb-title').textContent = m.title;
    document.getElementById('tb-desc').textContent  = m.desc;
    if (pageId.startsWith('chart-')) loadChart(pageId.replace('chart-', ''));
    if (pageId === 'admin')    loadAdminPanel();
    if (pageId === 'settings') loadSettingsPage();
    closeSidebar();
    window.scrollTo(0,0);
  }

  document.getElementById('hbtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('open');
  });
  document.getElementById('overlay').addEventListener('click', closeSidebar);
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
  }

  // ────────────────────────────────────────────────────────────
  // REPORTS PAGE — with date navigation
  // ────────────────────────────────────────────────────────────
  async function loadReports(date) {
    const loading = document.getElementById('reports-loading');
    const content = document.getElementById('reports-content');
    const empty   = document.getElementById('reports-empty');
    loading.style.display = 'flex';
    content.style.display = 'none';
    empty.style.display   = 'none';

    try {
      let reports;
      if (date) {
        // Load reports for a specific date — fetch each symbol
        reports = await Promise.all(
          SYMBOLS.map(sym =>
            api(`/api/reports/${sym}/${date}`).catch(() => null)
          )
        );
        reports = reports.filter(Boolean);
      } else {
        reports = await api('/api/reports/latest');
      }

      if (!reports || reports.length === 0) {
        loading.style.display = 'none';
        empty.style.display   = 'flex';
        // Still update date nav even if no reports for this date
        updateDateNav(date);
        return;
      }

      // Update current date context
      reportDate = reports[0].report_date?.split('T')[0] || date;
      updateDateNav(reportDate);

      // Update nav close prices
      reports.forEach(r => {
        const el = document.getElementById(`close-${r.symbol}`);
        if (el && r.close) el.textContent = fmtPrice(r.close, r.symbol);
      });

      const grid = document.getElementById('reports-grid');
      grid.innerHTML = '';
      reports.forEach(r => grid.appendChild(buildReportCard(r)));

      loading.style.display = 'none';
      content.style.display = 'block';

      // Load available dates for picker (async, non-blocking)
      loadAvailableDates();
    } catch (err) {
      loading.style.display = 'none';
      empty.style.display   = 'flex';
    }
  }

  async function loadAvailableDates() {
    // Get all available report dates (for the date picker boundary checks)
    try {
      const rows = await api('/api/reports/UK100?limit=500');
      if (rows && rows.length > 0) {
        allReportDates['all'] = rows.map(r => r.report_date?.split('T')[0]).filter(Boolean).sort();
        updateDatePickerBounds();
      }
    } catch { /* non-critical */ }
  }

  function updateDateNav(currentDate) {
    const navBar  = document.getElementById('date-nav');
    const dateEl  = document.getElementById('nav-date-display');
    const picker  = document.getElementById('date-picker');
    if (!navBar) return;
    navBar.style.display = 'flex';
    const isLatest = !currentDate || currentDate === allReportDates['all']?.slice(-1)[0];
    if (dateEl) {
      dateEl.textContent = currentDate
        ? new Date(currentDate).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'long', year:'numeric' })
        : 'Latest Report';
    }
    if (picker) picker.value = currentDate || '';
    const latestBtn = document.getElementById('nav-latest-btn');
    if (latestBtn) latestBtn.style.display = isLatest ? 'none' : 'flex';
  }

  function updateDatePickerBounds() {
    const picker = document.getElementById('date-picker');
    const dates  = allReportDates['all'];
    if (picker && dates && dates.length > 0) {
      picker.min = dates[0];
      picker.max = dates[dates.length - 1];
    }
  }

  function setupDateNav() {
    const prevBtn   = document.getElementById('nav-prev-btn');
    const nextBtn   = document.getElementById('nav-next-btn');
    const latestBtn = document.getElementById('nav-latest-btn');
    const picker    = document.getElementById('date-picker');

    if (prevBtn) prevBtn.addEventListener('click', () => navigateDate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateDate(+1));
    if (latestBtn) latestBtn.addEventListener('click', () => { reportDate = null; loadReports(null); });
    if (picker) {
      picker.addEventListener('change', function() {
        if (this.value) { reportDate = this.value; loadReports(this.value); }
      });
    }
  }

  function navigateDate(direction) {
    const dates = allReportDates['all'];
    if (!dates || dates.length === 0) return;
    const current = reportDate || dates[dates.length - 1];
    const idx = dates.indexOf(current);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= dates.length) return;
    reportDate = dates[newIdx];
    loadReports(reportDate);
  }

  function buildReportCard(r) {
    const bias     = r.bias || 'neutral';
    const pattern  = (r.candle_type || 'unknown').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const levels   = typeof r.key_levels === 'string' ? JSON.parse(r.key_levels) : r.key_levels || {};
    const symName  = SYMBOL_NAMES[r.symbol] || r.symbol;
    const dateStr  = new Date(r.report_date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const genTime  = r.generated_at ? new Date(r.generated_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC' : '';
    const biasEmoji = { bullish:'▲', bearish:'▼', neutral:'↔' }[bias] || '↔';
    const conf      = r.bias_confidence ? `${r.bias_confidence}%` : '';

    // Candle visual proportions
    const range    = (+levels.high||0) - (+levels.low||0);
    const bodySize = (+levels.body_high||0) - (+levels.body_low||0);
    const bodyH    = Math.max(6, Math.round(range>0 ? (bodySize/range)*70 : 30));
    const topW     = Math.max(4, Math.round(range>0 ? ((+levels.high - (+levels.body_high||+levels.high))/range)*70 : 16));
    const botW     = Math.max(4, Math.round(range>0 ? (((+levels.body_low||+levels.low) - +levels.low)/range)*70 : 16));
    const closePos = range > 0 ? Math.round((((+levels.close||0) - (+levels.low||0)) / range) * 85) : 50;

    // Narrative — extract the ANALYSIS section text
    let narrative = '';
    if (r.report_text) {
      const analysisIdx = r.report_text.indexOf('ANALYSIS\n');
      if (analysisIdx >= 0) {
        narrative = r.report_text.slice(analysisIdx + 9).trim().slice(0, 320) + '…';
      } else {
        narrative = r.short_summary || '';
      }
    }

    const card = document.createElement('div');
    card.className = 'report-card';
    card.innerHTML = `
      <div class="rc-head">
        <div><div class="rc-sym">${r.symbol}</div><span class="rc-full">${symName}</span></div>
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
            <p>${r.structure_label ? r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)+' · ' : ''}${conf ? 'Confidence '+conf : ''}</p>
          </div>
        </div>
        <div class="ohlc-grid">
          <div class="ohlc-item"><div class="ohlc-l">Open</div><div class="ohlc-v">${fmtPrice(levels.open,r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">High</div><div class="ohlc-v bearish">${fmtPrice(levels.high,r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">Low</div><div class="ohlc-v bullish">${fmtPrice(levels.low,r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">Close</div><div class="ohlc-v ${bias}">${fmtPrice(levels.close,r.symbol)}</div></div>
          <div class="ohlc-item" style="border-color:rgba(201,168,76,.2);background:rgba(201,168,76,.04)"><div class="ohlc-l" style="color:var(--go)">Body High</div><div class="ohlc-v gold">${fmtPrice(levels.body_high,r.symbol)}</div></div>
          <div class="ohlc-item" style="border-color:rgba(201,168,76,.2);background:rgba(201,168,76,.04)"><div class="ohlc-l" style="color:var(--go)">Body Low</div><div class="ohlc-v gold">${fmtPrice(levels.body_low,r.symbol)}</div></div>
        </div>
        <div class="key-levels">
          <div class="kl-title">Session Range</div>
          <div class="kl-row"><div class="kl-lbl">High</div><div class="kl-bar-wrap"><div class="kl-bar high" style="width:90%"></div></div><div class="kl-price">${fmtPrice(levels.high,r.symbol)}</div></div>
          <div class="kl-row"><div class="kl-lbl">Close</div><div class="kl-bar-wrap"><div class="kl-bar close" style="width:${closePos}%"></div></div><div class="kl-price">${fmtPrice(levels.close,r.symbol)}</div></div>
          <div class="kl-row"><div class="kl-lbl">Low</div><div class="kl-bar-wrap"><div class="kl-bar low" style="width:10%"></div></div><div class="kl-price">${fmtPrice(levels.low,r.symbol)}</div></div>
        </div>
        ${narrative ? `<div class="report-text-wrap"><div class="rt-label">Analysis</div><div class="rt-text">${narrative}</div></div>` : ''}
      </div>
      <div class="rc-footer">
        <span class="rc-ts">${dateStr}${genTime ? ' · '+genTime : ''}</span>
        ${r.structure_label ? `<span class="rc-struct ${r.structure_label}">${r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)}</span>` : ''}
      </div>`;
    return card;
  }

  // ────────────────────────────────────────────────────────────
  // CHARTS
  // ────────────────────────────────────────────────────────────
  const chartInited = {};
  async function loadChart(symbol) {
    if (chartInited[symbol]) return;
    const page = document.getElementById(`page-chart-${symbol}`);
    if (!page) return;
    const cp = page.querySelector('.chart-page');
    cp.innerHTML = `
      <div class="chart-toolbar">
        <div><div class="chart-sym-title">${symbol}</div><div style="font-size:11.5px;color:var(--tx2)">${SYMBOL_NAMES[symbol]}</div></div>
        <div id="chart-ohlc-${symbol}" style="display:flex;gap:14px;font-family:var(--fm);font-size:11px;color:var(--tx2);align-items:center;flex-wrap:wrap"></div>
        <div class="chart-range-btns">
          ${['1M','3M','6M','1Y','2Y','ALL'].map(r=>`<button class="range-btn${r==='1Y'?' active':''}" data-r="${r}" data-sym="${symbol}">${r}</button>`).join('')}
        </div>
      </div>
      <div id="chart-container-${symbol}" style="flex:1;border-radius:var(--r2);overflow:hidden;background:var(--sf);border:1px solid var(--bd)"></div>
      <div id="chart-tooltip-${symbol}" style="display:none;gap:14px;padding-top:10px;font-family:var(--fm);font-size:11px;color:var(--tx2)"></div>`;
    page.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        page.querySelectorAll('.range-btn').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        KaizokuCharts.setRange(symbol, {'1M':30,'3M':90,'6M':180,'1Y':365,'2Y':730,'ALL':9999}[this.dataset.r]);
      });
    });
    try {
      const res = await api(`/api/candles/${symbol}?limit=5000`);
      KaizokuCharts.initChart(symbol, `chart-container-${symbol}`, res.candles);
      chartInited[symbol] = true;
    } catch {
      cp.innerHTML += `<div class="empty-state"><div class="empty-icon">◫</div><h3>No chart data</h3><p>The EA has not sent data for ${symbol} yet.</p></div>`;
    }
  }

  // ────────────────────────────────────────────────────────────
  // EA STATUS
  // ────────────────────────────────────────────────────────────
  async function checkEAStatus() {
    try {
      const res = await api('/api/candles/', 'GET', null, true, 5000);
      const dot  = document.getElementById('ea-dot');
      const text = document.getElementById('ea-status-text');
      const sync = document.getElementById('ea-last-sync');
      if (res && res.length > 0) {
        dot.className    = 'ea-dot connected';
        text.textContent = 'EA Connected';
        const latest = [...res].sort((a,b)=>new Date(b.to_date)-new Date(a.to_date))[0];
        sync.textContent = `Last: ${new Date(latest.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}`;
      } else {
        dot.className    = 'ea-dot error';
        text.textContent = 'No data yet';
        sync.textContent = 'EA not connected';
      }
    } catch {
      document.getElementById('ea-dot').className        = 'ea-dot error';
      document.getElementById('ea-status-text').textContent = 'Offline';
    }
  }

  // ────────────────────────────────────────────────────────────
  // SETTINGS PAGE — profile edit + notifications + install
  // ────────────────────────────────────────────────────────────
  function loadSettingsPage() {
    // Pre-fill profile form
    const emailEl = document.getElementById('prof-email');
    const unameEl = document.getElementById('prof-username');
    const dnameEl = document.getElementById('prof-display');
    if (emailEl) emailEl.value = user.email || '';
    if (unameEl) unameEl.value = user.username || '';
    if (dnameEl) dnameEl.value = user.display_name || '';
    updateNotifUI();
    loadDataStatus();
  }

  function setupSettings() {
    // Profile form
    const profForm = document.getElementById('profile-form');
    if (profForm && !profForm.dataset.bound) {
      profForm.dataset.bound = '1';
      profForm.addEventListener('submit', async e => {
        e.preventDefault();
        const msgEl    = document.getElementById('prof-msg');
        const email    = document.getElementById('prof-email')?.value.trim();
        const username = document.getElementById('prof-username').value.trim();
        const display  = document.getElementById('prof-display').value.trim();
        msgEl.style.display = 'none';
        try {
          const updated = await api('/api/auth/profile', 'PATCH', { username, display_name: display, email: email || null });
          user.username     = updated.username;
          user.display_name = updated.display_name;
          user.email        = updated.email;
          localStorage.setItem('km_user', JSON.stringify(user));
          document.getElementById('user-chip').textContent = user.display_name || user.username;
          showMsg('prof-msg', 'success', '✓ Profile updated.');
        } catch (err) { showMsg('prof-msg', 'error', err.message); }
      });
    }

    // Password form
    const pwForm = document.getElementById('pw-form');
    if (pwForm && !pwForm.dataset.bound) {
      pwForm.dataset.bound = '1';
      pwForm.addEventListener('submit', async e => {
        e.preventDefault();
        const curr = document.getElementById('pw-current').value;
        const next = document.getElementById('pw-new').value;
        if (next.length < 8) { showMsg('pw-msg','error','New password must be at least 8 characters.'); return; }
        try {
          await api('/api/auth/change-password','POST',{current_password:curr,new_password:next});
          showMsg('pw-msg','success','✓ Password changed.');
          pwForm.reset();
        } catch (err) { showMsg('pw-msg','error',err.message); }
      });
    }

    // Notif button in topbar
    document.getElementById('notif-btn')?.addEventListener('click', () => navTo('settings'));
    document.getElementById('logout-btn')?.addEventListener('click', () => { if (confirm('Sign out?')) logout(); });
  }

  async function loadDataStatus() {
    const grid = document.getElementById('data-status');
    if (!grid) return;
    try {
      const res = await api('/api/candles/');
      if (!res || res.length === 0) { grid.innerHTML = '<p style="font-size:13px;color:var(--tx3)">No data yet.</p>'; return; }
      grid.innerHTML = res.map(s => `
        <div class="ds-row">
          <span class="ds-sym">${s.symbol}</span>
          <span class="ds-info">${s.total_candles} candles · Latest: ${new Date(s.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>
        </div>`).join('');
    } catch { grid.innerHTML = '<p style="font-size:13px;color:var(--tx3)">Could not load data status.</p>'; }
  }

  // ────────────────────────────────────────────────────────────
  // ADMIN PANEL — user management + EA key + run jobs
  // ────────────────────────────────────────────────────────────
  async function loadAdminPanel() {
    await Promise.all([loadUserList(), loadEAKey(), loadDataStatus()]);
  }

  async function loadUserList() {
    const container = document.getElementById('user-list');
    if (!container) return;
    container.innerHTML = '<div class="loading-inline"><div class="spinner-sm"></div></div>';
    try {
      const users = await api('/api/admin/users');
      renderUserList(users);
    } catch (err) {
      container.innerHTML = `<p style="color:var(--be);font-size:13px">${err.message}</p>`;
    }
  }

  function renderUserList(users) {
    const container = document.getElementById('user-list');
    const canAdd    = users.length < 4;
    container.innerHTML = users.map(u => `
      <div class="user-row" id="user-row-${u.id}">
        <div class="ur-info">
          <div class="ur-name">${u.display_name || u.username}</div>
          <div class="ur-meta">
            <span class="ur-username">@${u.username}</span>
            ${u.role === 'admin' ? '<span class="ur-badge admin">Admin</span>' : '<span class="ur-badge">User</span>'}
            ${u.last_login ? '<span class="ur-last">Last login: '+new Date(u.last_login).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+'</span>' : ''}
          </div>
        </div>
        <div class="ur-actions">
          <button class="btn-sm" onclick="App.editUser(${u.id}, '${u.display_name||u.username}', '${u.username}')">Edit</button>
          ${u.id !== (user && user.id) ? `<button class="btn-sm danger" onclick="App.deleteUser(${u.id}, '${u.username}')">Remove</button>` : ''}
        </div>
      </div>`).join('') +
      (canAdd ? `<div style="margin-top:12px"><button class="btn-secondary" id="show-add-user-btn" onclick="App.showAddUserForm()">+ Add User (${users.length}/4)</button></div>` : `<p style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-top:12px">Maximum 4 users reached.</p>`) +
      `<div id="add-user-form-wrap" style="display:none;margin-top:16px">${buildAddUserFormHTML()}</div>`;
  }

  function buildAddUserFormHTML() {
    return `<div class="inline-form-card">
      <div style="font-family:var(--fh);font-size:13.5px;font-weight:700;color:var(--tx);margin-bottom:14px">Add New User</div>
      <div class="field-row-2">
        <div class="field"><label>Username</label><input type="text" id="au-username" placeholder="e.g. friend2" autocomplete="off"></div>
        <div class="field"><label>Display Name</label><input type="text" id="au-display" placeholder="e.g. Friend 2"></div>
      </div>
      <div class="field"><label>Password (min 8 chars)</label><input type="password" id="au-password" placeholder="Password" autocomplete="new-password"></div>
      <div id="au-msg" class="form-msg" style="display:none"></div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn-primary" style="flex:1" onclick="App.submitAddUser()">Create User</button>
        <button class="btn-secondary" onclick="App.hideAddUserForm()">Cancel</button>
      </div>
    </div>`;
  }

  async function loadEAKey() {
    const container = document.getElementById('ea-key-display');
    if (!container) return;
    try {
      const res = await api('/api/admin/ea-key');
      container.innerHTML = `
        <div class="ea-key-box">
          <div class="ea-key-label">Current EA API Key</div>
          <div class="ea-key-value" id="ea-key-val">${maskKey(res.ea_key)}</div>
          <div class="ea-key-actions">
            <button class="btn-sm" onclick="App.toggleEAKey()">Show / Hide</button>
            <button class="btn-sm danger" onclick="App.regenEAKey()">Regenerate Key</button>
          </div>
          <div class="ea-key-instruction">Copy this key into the EA's <strong>InpApiKey</strong> parameter in MetaTrader 5.</div>
        </div>`;
      container._fullKey = res.ea_key;
    } catch (err) {
      container.innerHTML = `<p style="color:var(--be);font-size:13px">${err.message}</p>`;
    }
  }

  // ── Admin action helpers (exposed on App object) ──
  function editUser(id, displayName, username) {
    const row = document.getElementById(`user-row-${id}`);
    if (!row) return;
    const isCurrentUser = id === user.id;
    row.innerHTML = `
      <div style="width:100%">
        <div class="field-row-2" style="margin-bottom:10px">
          <div class="field"><label>Display Name</label><input type="text" id="edit-display-${id}" value="${displayName}"></div>
          <div class="field"><label>Username</label><input type="text" id="edit-username-${id}" value="${username}" ${!isCurrentUser?'':''}></div>
        </div>
        <div class="field" style="margin-bottom:10px"><label>New Password (leave blank to keep)</label><input type="password" id="edit-pass-${id}" placeholder="Optional — min 8 chars" autocomplete="new-password"></div>
        <div id="edit-msg-${id}" class="form-msg" style="display:none"></div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" style="flex:1" onclick="App.submitEditUser(${id})">Save Changes</button>
          <button class="btn-secondary" onclick="App.loadUserList()">Cancel</button>
        </div>
      </div>`;
  }

  async function submitEditUser(id) {
    const display  = document.getElementById(`edit-display-${id}`)?.value.trim();
    const uname    = document.getElementById(`edit-username-${id}`)?.value.trim();
    const pass     = document.getElementById(`edit-pass-${id}`)?.value;
    const msgEl    = document.getElementById(`edit-msg-${id}`);
    const body = {};
    if (display) body.display_name = display;
    if (uname)   body.username     = uname;
    if (pass) {
      if (pass.length < 8) { showMsg(`edit-msg-${id}`, 'error', 'Password must be at least 8 chars.'); return; }
      body.password = pass;
    }
    try {
      await api(`/api/admin/users/${id}`, 'PATCH', body);
      // If editing own profile, update local user
      if (id === user.id) {
        if (body.display_name) { user.display_name = body.display_name; document.getElementById('user-chip').textContent = user.display_name; }
        if (body.username) user.username = body.username;
        localStorage.setItem('km_user', JSON.stringify(user));
      }
      loadUserList();
    } catch (err) { showMsg(`edit-msg-${id}`, 'error', err.message); }
  }

  async function deleteUser(id, username) {
    if (!confirm(`Remove user "@${username}"? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${id}`, 'DELETE');
      loadUserList();
    } catch (err) { alert(err.message); }
  }

  function showAddUserForm() {
    document.getElementById('add-user-form-wrap').style.display = 'block';
    document.getElementById('show-add-user-btn').style.display  = 'none';
  }

  function hideAddUserForm() {
    document.getElementById('add-user-form-wrap').style.display = 'none';
    document.getElementById('show-add-user-btn').style.display  = 'block';
  }

  async function submitAddUser() {
    const uname = document.getElementById('au-username')?.value.trim();
    const dname = document.getElementById('au-display')?.value.trim();
    const pass  = document.getElementById('au-password')?.value;
    if (!uname) { showMsg('au-msg','error','Username required.'); return; }
    if (!pass || pass.length < 8) { showMsg('au-msg','error','Password must be at least 8 characters.'); return; }
    try {
      await api('/api/admin/users', 'POST', { username:uname, display_name:dname||uname, password:pass });
      loadUserList();
    } catch (err) { showMsg('au-msg','error',err.message); }
  }

  let eaKeyVisible = false;
  function toggleEAKey() {
    const el = document.getElementById('ea-key-val');
    const container = document.getElementById('ea-key-display');
    if (!el || !container._fullKey) return;
    eaKeyVisible = !eaKeyVisible;
    el.textContent = eaKeyVisible ? container._fullKey : maskKey(container._fullKey);
    el.style.fontFamily = 'var(--fm)';
    el.style.wordBreak  = 'break-all';
  }

  async function regenEAKey() {
    if (!confirm('Regenerate EA API key? The EA will stop working until you update the key in MetaTrader 5.')) return;
    try {
      const res = await api('/api/admin/ea-key/regenerate', 'POST');
      eaKeyVisible = true;
      await loadEAKey();
      // Auto-show new key
      const el = document.getElementById('ea-key-val');
      const container = document.getElementById('ea-key-display');
      if (el && container._fullKey) { el.textContent = container._fullKey; el.style.wordBreak = 'break-all'; }
    } catch (err) { alert(err.message); }
  }

  function maskKey(key) {
    if (!key) return '—';
    return key.slice(0,8) + '••••••••••••••••••••••••••••••••••••••••••••••••' + key.slice(-4);
  }

  // Run jobs button
  document.getElementById('run-jobs-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('run-jobs-btn');
    btn.disabled = true; btn.textContent = 'Running...';
    try {
      await api('/api/admin/run-jobs', 'POST');
      showMsg('jobs-msg','success','✓ Jobs started — reports will update in ~15 minutes.');
    } catch (err) {
      showMsg('jobs-msg','error',err.message);
    } finally {
      setTimeout(()=>{ btn.disabled=false; btn.textContent='Run Nightly Jobs Now'; },3000);
    }
  });

  // ────────────────────────────────────────────────────────────
  // PUSH NOTIFICATIONS
  // ────────────────────────────────────────────────────────────
  async function fetchVapidKey() {
    try {
      const res = await api('/api/push/vapid-public-key','GET',null,false);
      vapidKey = res.key;
      updateNotifUI();
    } catch { /* VAPID not configured yet */ }
  }

  async function subscribeNotifications() {
    if (!('PushManager' in window)) { alert('Push not supported in this browser.'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { updateNotifUI('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(vapidKey) });
      await api('/api/push/subscribe','POST',{ subscription:sub.toJSON(), device_label:navigator.platform||'Browser' });
      updateNotifUI('subscribed');
    } catch (err) { alert('Could not enable notifications: ' + err.message); }
  }

  async function unsubscribeNotifications() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('/api/push/unsubscribe','POST',{endpoint:sub.endpoint}); await sub.unsubscribe(); }
      updateNotifUI('unsubscribed');
    } catch (err) { console.error(err); }
  }

  async function updateNotifUI(state = null) {
    const box = document.getElementById('notif-status-box');
    const btn = document.getElementById('notif-toggle-btn');
    if (!box || !btn) return;
    if (!('Notification' in window)) { box.textContent = 'Notifications not supported.'; btn.style.display='none'; return; }
    if (!vapidKey) { box.textContent = 'Push not yet configured on server (VAPID keys needed).'; btn.style.display='none'; return; }
    const reg = await navigator.serviceWorker?.ready;
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub || state === 'subscribed') {
      box.textContent = '✓ Notifications enabled — you will receive daily reports.';
      btn.textContent = 'Disable Notifications'; btn.onclick = unsubscribeNotifications;
    } else if (Notification.permission === 'denied' || state === 'denied') {
      box.textContent = 'Notifications blocked. Enable them in browser settings.'; btn.style.display = 'none';
    } else {
      box.textContent = 'Not enabled — click below to get notified after each daily report.';
      btn.textContent = 'Enable Notifications'; btn.onclick = subscribeNotifications;
    }
  }

  // ────────────────────────────────────────────────────────────
  // PWA INSTALL
  // ────────────────────────────────────────────────────────────
  let deferredPrompt = null;
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredPrompt = e;
      const btn = document.getElementById('install-btn');
      if (btn) btn.style.display = 'block';
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      const btn  = document.getElementById('install-btn');
      const note = document.getElementById('install-note');
      if (btn) btn.style.display = 'none';
      if (note) { note.textContent = '✓ App installed!'; note.style.display = 'block'; }
    });
    document.getElementById('install-btn')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
    });
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !window.matchMedia('(display-mode: standalone)').matches) {
      const note = document.getElementById('install-note');
      if (note) { note.textContent = 'On iPhone/iPad: tap Share → Add to Home Screen.'; note.style.display='block'; }
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

  // ────────────────────────────────────────────────────────────
  // UTILITIES
  // ────────────────────────────────────────────────────────────
  function updateDate() {
    const el = document.getElementById('tb-date');
    if (el) el.textContent = new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  }

  async function api(path, method='GET', body=null, auth=true, timeout=10000) {
    const headers = { 'Content-Type':'application/json' };
    if (auth && token) headers['Authorization'] = `Bearer ${token}`;
    const ctrl  = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeout);
    try {
      const res  = await fetch(path, { method, headers, body: body?JSON.stringify(body):undefined, signal:ctrl.signal });
      clearTimeout(timer);
      if (res.status === 401 || res.status === 403) { if (auth) logout(); throw new Error('Unauthorised'); }
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

  function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4-b64.length%4)%4);
    const base64  = (b64+padding).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from([...window.atob(base64)].map(c=>c.charCodeAt(0)));
  }

  function showMsg(elId, type, text) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className     = `form-msg ${type}`;
    el.textContent   = text;
    el.style.display = 'block';
    setTimeout(()=>{ el.style.display='none'; }, 5000);
  }

  // ────────────────────────────────────────────────────────────
  // BOOT
  // ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    setupDateNav();
    init();
  });

  // Expose admin helpers for inline onclick attributes
  return {
    editUser, submitEditUser, deleteUser,
    showAddUserForm, hideAddUserForm, submitAddUser,
    toggleEAKey, regenEAKey, loadUserList,
  };
})();
