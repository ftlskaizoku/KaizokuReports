'use strict';
// ═══════════════════════════════════════════════════════════
// KAIZOKU REPORTS — Frontend App
// ═══════════════════════════════════════════════════════════

const App = (() => {
  const SYMBOLS      = ['UK100','DE30','XAUUSD','USOIL'];
  const SYMBOL_NAMES = { UK100:'FTSE 100', DE30:'DAX 40', XAUUSD:'Gold (XAU/USD)', USOIL:'US Crude Oil' };

  let token = null;
  let user  = null;
  let vapidKey = null;
  let reportDate = null;
  let allReportDates = [];

  // ── BOOT ──────────────────────────────────────────────────
  async function init() {
    token = localStorage.getItem('km_token');
    user  = JSON.parse(localStorage.getItem('km_user') || 'null');

    registerServiceWorker();
    setupInstallPrompt();
    updateDate();
    setInterval(updateDate, 60000);

    // Hide boot screen after brief moment (CSS loaded)
    await new Promise(r => setTimeout(r, 400));

    document.getElementById('boot-screen').style.display = 'none';

    if (token && user) {
      try {
        user = await api('/api/auth/me');
        showApp();
        return;
      } catch {
        logout(false);
      }
    }

    showAuth();
  }

  // ── AUTH SCREENS ──────────────────────────────────────────
  function showAuth() {
    document.getElementById('auth-wrap').style.display = 'block';
    document.getElementById('app').style.display       = 'none';
    setupAuthForms();
    setupTabSwitcher();
    setupPasswordToggles();
  }

  function setupTabSwitcher() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', function() {
        const target = this.dataset.tab;
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
        this.classList.add('active');
        document.getElementById('panel-' + target).classList.add('active');
        clearAuthErrors();
      });
    });
  }

  function setupPasswordToggles() {
    document.querySelectorAll('.pw-toggle').forEach(btn => {
      btn.addEventListener('click', function() {
        const input = document.getElementById(this.dataset.target);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        this.textContent = isPassword ? '🙈' : '👁';
      });
    });
  }

  function clearAuthErrors() {
    document.querySelectorAll('.auth-error, .auth-success').forEach(el => el.style.display = 'none');
  }

  function setupAuthForms() {
    // LOGIN
    const loginForm = document.getElementById('login-form');
    if (loginForm && !loginForm.dataset.bound) {
      loginForm.dataset.bound = '1';
      loginForm.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('login-btn');
        const errEl = document.getElementById('login-error');
        errEl.style.display = 'none';
        btn.disabled = true; btn.textContent = 'Signing in...';
        try {
          const data = await api('/api/auth/login', 'POST', {
            login: document.getElementById('login-field').value.trim(),
            password: document.getElementById('login-password').value,
          }, false);
          saveSession(data);
          showApp();
        } catch(err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Sign In';
        }
      });
    }

    // SIGNUP
    const signupForm = document.getElementById('signup-form');
    if (signupForm && !signupForm.dataset.bound) {
      signupForm.dataset.bound = '1';
      signupForm.addEventListener('submit', async e => {
        e.preventDefault();
        const btn = document.getElementById('signup-btn');
        const errEl = document.getElementById('signup-error');
        const okEl  = document.getElementById('signup-success');
        errEl.style.display = 'none'; okEl.style.display = 'none';
        btn.disabled = true; btn.textContent = 'Creating account...';
        try {
          const data = await api('/api/auth/signup', 'POST', {
            display_name: document.getElementById('signup-display').value.trim(),
            email:        document.getElementById('signup-email').value.trim(),
            username:     document.getElementById('signup-username').value.trim(),
            password:     document.getElementById('signup-password').value,
          }, false);
          saveSession(data);
          showApp();
        } catch(err) {
          errEl.textContent = err.message;
          errEl.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Create Account';
        }
      });
    }
  }

  function saveSession(data) {
    token = data.token; user = data.user;
    localStorage.setItem('km_token', token);
    localStorage.setItem('km_user', JSON.stringify(user));
  }

  function logout(redirect = true) {
    token = null; user = null;
    localStorage.removeItem('km_token');
    localStorage.removeItem('km_user');
    if (redirect) {
      document.getElementById('app').style.display   = 'none';
      document.getElementById('auth-wrap').style.display = 'block';
      // Reset to login tab
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'login'));
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-login'));
      clearAuthErrors();
    }
  }

  // ── APP ────────────────────────────────────────────────────
  function showApp() {
    document.getElementById('auth-wrap').style.display = 'none';
    document.getElementById('app').style.display       = 'flex';
    document.getElementById('user-chip').textContent   = user.display_name || user.username;

    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = user.role === 'admin' ? 'flex' : 'none';

    setupNav();
    setupLogout();
    setupSettings();
    setupDateNav();
    loadReports(null);
    checkEAStatus();
    setInterval(checkEAStatus, 90000);
    fetchVapidKey();

    navigator.serviceWorker?.addEventListener('message', e => {
      if (e.data?.type === 'NAVIGATE') navTo('reports');
    });
  }

  // ── NAVIGATION ─────────────────────────────────────────────
  const PAGE_META = {
    reports:        { title:'Daily Reports',        desc:'Latest candle analysis · All symbols' },
    'chart-UK100':  { title:'UK100 — FTSE 100',     desc:'Daily candlestick chart' },
    'chart-DE30':   { title:'DE30 — DAX 40',        desc:'Daily candlestick chart' },
    'chart-XAUUSD': { title:'XAUUSD — Gold',        desc:'Daily candlestick chart' },
    'chart-USOIL':  { title:'USOIL — US Crude Oil', desc:'Daily candlestick chart' },
    settings:       { title:'Settings',             desc:'Profile · Notifications · Install' },
    admin:          { title:'Admin Panel',          desc:'Users · EA Key · System' },
  };

  function setupNav() {
    document.querySelectorAll('.nav-a[data-page]').forEach(el => {
      el.addEventListener('click', function() { navTo(this.dataset.page); });
    });
    document.getElementById('hbtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('overlay').classList.toggle('open');
    });
    document.getElementById('overlay').addEventListener('click', closeSidebar);
  }

  function navTo(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-a').forEach(n => n.classList.remove('active'));
    document.getElementById(`page-${pageId}`)?.classList.add('active');
    document.querySelector(`.nav-a[data-page="${pageId}"]`)?.classList.add('active');
    const m = PAGE_META[pageId] || { title: pageId, desc: '' };
    document.getElementById('tb-title').textContent = m.title;
    document.getElementById('tb-desc').textContent  = m.desc;
    if (pageId.startsWith('chart-')) loadChart(pageId.replace('chart-', ''));
    if (pageId === 'admin')    loadAdminPanel();
    if (pageId === 'settings') loadSettingsPage();
    closeSidebar();
    window.scrollTo(0, 0);
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('open');
  }

  // ── REPORTS ────────────────────────────────────────────────
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
        reports = (await Promise.all(
          SYMBOLS.map(sym => api(`/api/reports/${sym}/${date}`).catch(() => null))
        )).filter(Boolean);
      } else {
        reports = await api('/api/reports/latest');
      }
      if (!reports || reports.length === 0) {
        loading.style.display = 'none'; empty.style.display = 'flex';
        updateDateNav(date); return;
      }
      reportDate = reports[0].report_date?.split('T')[0] || date;
      updateDateNav(reportDate);
      reports.forEach(r => {
        const el = document.getElementById(`close-${r.symbol}`);
        if (el && r.close) el.textContent = fmtPrice(r.close, r.symbol);
      });
      const grid = document.getElementById('reports-grid');
      grid.innerHTML = '';
      reports.forEach(r => grid.appendChild(buildReportCard(r)));
      loading.style.display = 'none'; content.style.display = 'block';
      loadAvailableDates();
    } catch {
      loading.style.display = 'none'; empty.style.display = 'flex';
    }
  }

  async function loadAvailableDates() {
    try {
      const rows = await api('/api/reports/UK100?limit=500');
      if (rows?.length) {
        allReportDates = rows.map(r => r.report_date?.split('T')[0]).filter(Boolean).sort();
        const picker = document.getElementById('date-picker');
        if (picker && allReportDates.length) {
          picker.min = allReportDates[0];
          picker.max = allReportDates[allReportDates.length - 1];
        }
      }
    } catch {}
  }

  function updateDateNav(currentDate) {
    const navBar = document.getElementById('date-nav');
    if (!navBar) return;
    navBar.style.display = 'flex';
    const el = document.getElementById('nav-date-display');
    if (el) el.textContent = currentDate
      ? new Date(currentDate).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'long', year:'numeric' })
      : 'Latest Report';
    const picker = document.getElementById('date-picker');
    if (picker) picker.value = currentDate || '';
    const isLatest = !currentDate || currentDate === allReportDates[allReportDates.length - 1];
    const latestBtn = document.getElementById('nav-latest-btn');
    if (latestBtn) latestBtn.style.display = isLatest ? 'none' : 'flex';
  }

  function setupDateNav() {
    document.getElementById('nav-prev-btn')?.addEventListener('click', () => navigateDate(-1));
    document.getElementById('nav-next-btn')?.addEventListener('click', () => navigateDate(+1));
    document.getElementById('nav-latest-btn')?.addEventListener('click', () => { reportDate = null; loadReports(null); });
    document.getElementById('date-picker')?.addEventListener('change', function() {
      if (this.value) { reportDate = this.value; loadReports(this.value); }
    });
  }

  function navigateDate(dir) {
    if (!allReportDates.length) return;
    const current = reportDate || allReportDates[allReportDates.length - 1];
    const idx = allReportDates.indexOf(current);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= allReportDates.length) return;
    reportDate = allReportDates[newIdx];
    loadReports(reportDate);
  }

  function buildReportCard(r) {
    const bias     = r.bias || 'neutral';
    const pattern  = (r.candle_type || 'unknown').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
    const levels   = typeof r.key_levels === 'string' ? JSON.parse(r.key_levels) : r.key_levels || {};
    const symName  = SYMBOL_NAMES[r.symbol] || r.symbol;
    const dateStr  = new Date(r.report_date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const genTime  = r.generated_at ? new Date(r.generated_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + ' UTC' : '';
    const biasEmoji = {bullish:'▲',bearish:'▼',neutral:'↔'}[bias] || '↔';
    const conf = r.bias_confidence ? `${r.bias_confidence}% confidence` : '';
    const range    = (+levels.high||0) - (+levels.low||0);
    const bodyH    = Math.max(6, Math.round(range>0 ? ((+levels.body_high||0)-(+levels.body_low||0))/range*70 : 30));
    const topW     = Math.max(4, Math.round(range>0 ? ((+levels.high||0)-(+levels.body_high||+levels.high||0))/range*70 : 16));
    const botW     = Math.max(4, Math.round(range>0 ? ((+levels.body_low||+levels.low||0)-(+levels.low||0))/range*70 : 16));
    const closePos = range>0 ? Math.round(((+levels.close||0)-(+levels.low||0))/range*85) : 50;
    let narrative = '';
    if (r.report_text) {
      const idx = r.report_text.indexOf('ANALYSIS\n');
      narrative = (idx >= 0 ? r.report_text.slice(idx+9) : r.short_summary||'').trim().slice(0,300) + '…';
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
            <p>${r.structure_label?r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)+' · ':''}${conf}</p>
          </div>
        </div>
        <div class="ohlc-grid">
          <div class="ohlc-item"><div class="ohlc-l">Open</div><div class="ohlc-v">${fmtPrice(levels.open,r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">High</div><div class="ohlc-v bearish">${fmtPrice(levels.high,r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">Low</div><div class="ohlc-v bullish">${fmtPrice(levels.low,r.symbol)}</div></div>
          <div class="ohlc-item"><div class="ohlc-l">Close</div><div class="ohlc-v ${bias}">${fmtPrice(levels.close,r.symbol)}</div></div>
          <div class="ohlc-item" style="border-color:var(--vi-bd);background:var(--vi-bg)"><div class="ohlc-l" style="color:var(--vi3)">Body High</div><div class="ohlc-v violet">${fmtPrice(levels.body_high,r.symbol)}</div></div>
          <div class="ohlc-item" style="border-color:var(--vi-bd);background:var(--vi-bg)"><div class="ohlc-l" style="color:var(--vi3)">Body Low</div><div class="ohlc-v violet">${fmtPrice(levels.body_low,r.symbol)}</div></div>
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
        <span class="rc-ts">${dateStr}${genTime?' · '+genTime:''}</span>
        ${r.structure_label?`<span class="rc-struct ${r.structure_label}">${r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)}</span>`:''}
      </div>`;
    return card;
  }

  // ── CHARTS ─────────────────────────────────────────────────
  const chartInited = {};
  async function loadChart(symbol) {
    if (chartInited[symbol]) return;
    const page = document.getElementById(`page-chart-${symbol}`);
    if (!page) return;
    const cp = page.querySelector('.chart-page');
    cp.innerHTML = `
      <div class="chart-toolbar">
        <div><div class="chart-sym-title">${symbol}</div><div style="font-size:11.5px;color:var(--tx2)">${SYMBOL_NAMES[symbol]}</div></div>
        <div class="chart-range-btns">
          ${['1M','3M','6M','1Y','2Y','ALL'].map(r=>`<button class="range-btn${r==='1Y'?' active':''}" data-r="${r}">${r}</button>`).join('')}
        </div>
      </div>
      <div id="chart-container-${symbol}" style="flex:1;border-radius:var(--r2);overflow:hidden;background:var(--sf);border:1px solid var(--bd)"></div>`;
    page.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        page.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        KaizokuCharts.setRange(symbol, {'1M':30,'3M':90,'6M':180,'1Y':365,'2Y':730,'ALL':9999}[this.dataset.r]);
      });
    });
    try {
      const res = await api(`/api/candles/${symbol}?limit=5000`);
      KaizokuCharts.initChart(symbol, `chart-container-${symbol}`, res.candles);
      chartInited[symbol] = true;
    } catch {
      cp.innerHTML += `<div class="empty-state"><div class="empty-icon">◫</div><h3>No data yet</h3><p>The EA has not sent data for ${symbol}.</p></div>`;
    }
  }

  // ── EA STATUS ──────────────────────────────────────────────
  async function checkEAStatus() {
    try {
      const res = await api('/api/candles/', 'GET', null, true, 5000);
      const dot  = document.getElementById('ea-dot');
      const text = document.getElementById('ea-status-text');
      const sync = document.getElementById('ea-last-sync');
      if (res?.length) {
        dot.className    = 'ea-dot connected';
        text.textContent = 'EA Connected';
        const latest = [...res].sort((a,b) => new Date(b.to_date)-new Date(a.to_date))[0];
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

  // ── SETTINGS ───────────────────────────────────────────────
  function loadSettingsPage() {
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
    const profForm = document.getElementById('profile-form');
    if (profForm && !profForm.dataset.bound) {
      profForm.dataset.bound = '1';
      profForm.addEventListener('submit', async e => {
        e.preventDefault();
        try {
          const updated = await api('/api/auth/profile', 'PATCH', {
            email:        document.getElementById('prof-email')?.value.trim() || null,
            username:     document.getElementById('prof-username').value.trim(),
            display_name: document.getElementById('prof-display').value.trim(),
          });
          user = { ...user, ...updated };
          localStorage.setItem('km_user', JSON.stringify(user));
          document.getElementById('user-chip').textContent = user.display_name || user.username;
          showMsg('prof-msg', 'success', '✓ Profile updated.');
        } catch(err) { showMsg('prof-msg', 'error', err.message); }
      });
    }
    const pwForm = document.getElementById('pw-form');
    if (pwForm && !pwForm.dataset.bound) {
      pwForm.dataset.bound = '1';
      pwForm.addEventListener('submit', async e => {
        e.preventDefault();
        const curr = document.getElementById('pw-current').value;
        const next = document.getElementById('pw-new').value;
        if (next.length < 8) { showMsg('pw-msg','error','Min 8 characters.'); return; }
        try {
          await api('/api/auth/change-password','POST',{current_password:curr,new_password:next});
          showMsg('pw-msg','success','✓ Password changed.');
          pwForm.reset();
        } catch(err) { showMsg('pw-msg','error',err.message); }
      });
    }
    document.getElementById('notif-btn')?.addEventListener('click', () => navTo('settings'));
    document.getElementById('run-jobs-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('run-jobs-btn');
      btn.disabled = true; btn.textContent = 'Running...';
      try {
        await api('/api/admin/run-jobs', 'POST');
        showMsg('jobs-msg','success','✓ Jobs started — reports update in ~2 minutes.');
      } catch(err) { showMsg('jobs-msg','error',err.message); }
      finally { setTimeout(()=>{ btn.disabled=false; btn.textContent='Run Nightly Jobs Now'; },4000); }
    });
  }

  function setupLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', () => { if (confirm('Sign out?')) logout(); });
  }

  async function loadDataStatus() {
    const grid = document.getElementById('data-status');
    if (!grid) return;
    try {
      const res = await api('/api/candles/');
      grid.innerHTML = res?.length
        ? res.map(s=>`<div class="ds-row"><span class="ds-sym">${s.symbol}</span><span class="ds-info">${s.total_candles} candles · Latest: ${new Date(s.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span></div>`).join('')
        : '<p style="font-size:13px;color:var(--tx3)">No data received yet.</p>';
    } catch { grid.innerHTML = '<p style="font-size:13px;color:var(--tx3)">Could not load data status.</p>'; }
  }

  // ── ADMIN ──────────────────────────────────────────────────
  async function loadAdminPanel() {
    await Promise.all([loadUserList(), loadEAKey()]);
  }

  async function loadUserList() {
    const container = document.getElementById('user-list');
    if (!container) return;
    container.innerHTML = '<div class="loading-inline"><div class="spinner-sm"></div> Loading users...</div>';
    try {
      const users = await api('/api/admin/users');
      container.innerHTML = users.map(u => `
        <div class="user-row" id="user-row-${u.id}">
          <div class="ur-info">
            <div class="ur-name">${u.display_name||u.username}</div>
            <div class="ur-meta">
              <span class="ur-username">@${u.username}</span>
              <span class="ur-badge ${u.role==='admin'?'admin':''}">${u.role==='admin'?'Admin':'User'}</span>
              ${u.status==='suspended'?'<span class="ur-badge" style="background:var(--be-bg);border-color:var(--be-bd);color:var(--be)">Suspended</span>':''}
              ${u.last_login?'<span class="ur-last">Last: '+new Date(u.last_login).toLocaleDateString('en-GB',{day:'numeric',month:'short'})+'</span>':''}
            </div>
          </div>
          <div class="ur-actions">
            <button class="btn-sm" onclick="App.editUser(${u.id},'${(u.display_name||u.username).replace(/'/g,"\\'")}','${u.username}','${u.email||''}','${u.role}')">Edit</button>
            ${u.id !== user.id ? `<button class="btn-sm danger" onclick="App.toggleSuspend(${u.id},'${u.status||'active'}','${u.username}')">${u.status==='suspended'?'Restore':'Suspend'}</button>` : ''}
          </div>
        </div>`).join('') +
        `<p style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-top:12px">${users.length} registered user${users.length!==1?'s':''}. New users sign up themselves at the app URL.</p>`;
    } catch(err) {
      container.innerHTML = `<p style="color:var(--be);font-size:13px">${err.message}</p>`;
    }
  }

  function editUser(id, displayName, username, email, role) {
    const row = document.getElementById(`user-row-${id}`);
    if (!row) return;
    row.innerHTML = `
      <div style="width:100%">
        <div class="field-row-2" style="margin-bottom:10px">
          <div class="field"><label>Display Name</label><input type="text" id="edit-display-${id}" value="${displayName}"></div>
          <div class="field"><label>Role</label>
            <select id="edit-role-${id}" style="background:var(--bg2);border:1px solid var(--bd2);border-radius:var(--r);padding:10px 12px;color:var(--tx);font-size:14px">
              <option value="user" ${role==='user'?'selected':''}>User</option>
              <option value="admin" ${role==='admin'?'selected':''}>Admin</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin-bottom:10px"><label>Email</label><input type="email" id="edit-email-${id}" value="${email}"></div>
        <div class="field" style="margin-bottom:10px"><label>New Password (optional)</label><input type="password" id="edit-pass-${id}" placeholder="Leave blank to keep current" autocomplete="new-password"></div>
        <div id="edit-msg-${id}" class="form-msg" style="display:none"></div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" style="flex:1" onclick="App.submitEditUser(${id})">Save</button>
          <button class="btn-secondary" onclick="App.loadUserList()">Cancel</button>
        </div>
      </div>`;
  }

  async function submitEditUser(id) {
    const display = document.getElementById(`edit-display-${id}`)?.value.trim();
    const email   = document.getElementById(`edit-email-${id}`)?.value.trim();
    const role    = document.getElementById(`edit-role-${id}`)?.value;
    const pass    = document.getElementById(`edit-pass-${id}`)?.value;
    const body = {};
    if (display) body.display_name = display;
    if (email)   body.email = email;
    if (role)    body.role = role;
    if (pass) { if (pass.length < 8) { showMsg(`edit-msg-${id}`,'error','Password min 8 chars.'); return; } body.password = pass; }
    try {
      await api(`/api/admin/users/${id}`, 'PATCH', body);
      if (id === user.id) { if (body.display_name) { user.display_name = body.display_name; document.getElementById('user-chip').textContent = user.display_name; } localStorage.setItem('km_user',JSON.stringify(user)); }
      loadUserList();
    } catch(err) { showMsg(`edit-msg-${id}`,'error',err.message); }
  }

  async function toggleSuspend(id, currentStatus, username) {
    const newStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
    const action = newStatus === 'suspended' ? 'Suspend' : 'Restore';
    if (!confirm(`${action} @${username}?`)) return;
    try { await api(`/api/admin/users/${id}`, 'PATCH', { status: newStatus }); loadUserList(); }
    catch(err) { alert(err.message); }
  }

  async function loadEAKey() {
    const container = document.getElementById('ea-key-display');
    if (!container) return;
    try {
      const res = await api('/api/admin/ea-key');
      container._fullKey = res.ea_key;
      container.innerHTML = `
        <div class="ea-key-box">
          <div class="ea-key-label">Current EA API Key</div>
          <div class="ea-key-value" id="ea-key-val">${'•'.repeat(40)}</div>
          <div class="ea-key-actions">
            <button class="btn-sm" onclick="App.toggleEAKey()">Show / Hide</button>
            <button class="btn-sm danger" onclick="App.regenEAKey()">Regenerate</button>
          </div>
          <div class="ea-key-instruction">Copy this key into MetaTrader 5 → EA Inputs → <strong style="color:var(--tx)">InpApiKey</strong></div>
        </div>`;
    } catch(err) { container.innerHTML = `<p style="color:var(--be);font-size:13px">${err.message}</p>`; }
  }

  let eaKeyVisible = false;
  function toggleEAKey() {
    const el = document.getElementById('ea-key-val');
    const container = document.getElementById('ea-key-display');
    if (!el || !container._fullKey) return;
    eaKeyVisible = !eaKeyVisible;
    el.textContent = eaKeyVisible ? container._fullKey : '•'.repeat(40);
    el.style.wordBreak = 'break-all';
  }

  async function regenEAKey() {
    if (!confirm('Regenerate key? The EA will stop working until you update InpApiKey in MetaTrader 5.')) return;
    try {
      const res = await api('/api/admin/ea-key/regenerate', 'POST');
      const container = document.getElementById('ea-key-display');
      if (container) { container._fullKey = res.ea_key; eaKeyVisible = true; }
      const el = document.getElementById('ea-key-val');
      if (el) { el.textContent = res.ea_key; el.style.wordBreak = 'break-all'; }
    } catch(err) { alert(err.message); }
  }

  // ── PUSH NOTIFICATIONS ─────────────────────────────────────
  async function fetchVapidKey() {
    try { const r = await api('/api/push/vapid-public-key','GET',null,false); vapidKey = r.key; updateNotifUI(); }
    catch {}
  }

  async function subscribeNotifications() {
    if (!('PushManager' in window)) { alert('Push not supported in this browser.'); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { updateNotifUI('denied'); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      await api('/api/push/subscribe','POST',{ subscription: sub.toJSON(), device_label: navigator.platform||'Browser' });
      updateNotifUI('subscribed');
    } catch(err) { alert('Could not enable notifications: ' + err.message); }
  }

  async function unsubscribeNotifications() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('/api/push/unsubscribe','POST',{endpoint:sub.endpoint}); await sub.unsubscribe(); }
      updateNotifUI('unsubscribed');
    } catch {}
  }

  async function updateNotifUI(state = null) {
    const box = document.getElementById('notif-status-box');
    const btn = document.getElementById('notif-toggle-btn');
    if (!box || !btn) return;
    if (!('Notification' in window)) { box.textContent = 'Notifications not supported in this browser.'; btn.style.display='none'; return; }
    if (!vapidKey) { box.textContent = 'Push notifications not yet configured (VAPID keys needed in Netlify Variables).'; btn.style.display='none'; return; }
    const reg = await navigator.serviceWorker?.ready;
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub || state === 'subscribed') {
      box.textContent = '✓ Notifications enabled — you will receive daily reports.';
      btn.textContent = 'Disable Notifications'; btn.onclick = unsubscribeNotifications;
    } else if (Notification.permission === 'denied' || state === 'denied') {
      box.textContent = 'Blocked. Enable in browser settings.'; btn.style.display = 'none';
    } else {
      box.textContent = 'Not enabled. Click below to get daily report alerts.';
      btn.textContent = 'Enable Notifications'; btn.onclick = subscribeNotifications;
    }
  }

  // ── PWA ────────────────────────────────────────────────────
  let deferredPrompt = null;
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredPrompt = e;
      const btn = document.getElementById('install-btn');
      if (btn) btn.style.display = 'block';
    });
    document.getElementById('install-btn')?.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null;
    });
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS && !window.matchMedia('(display-mode: standalone)').matches) {
      const note = document.getElementById('install-note');
      if (note) { note.textContent = 'On iPhone/iPad: tap Share → Add to Home Screen.'; note.style.display='block'; }
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ── UTILS ──────────────────────────────────────────────────
  function updateDate() {
    const el = document.getElementById('tb-date');
    if (el) el.textContent = new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  }

  async function api(path, method='GET', body=null, auth=true, timeout=10000) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && token) headers['Authorization'] = `Bearer ${token}`;
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res  = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      clearTimeout(timer);
      if ((res.status === 401 || res.status === 403) && auth) { logout(); throw new Error('Session expired.'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      return data;
    } catch(err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out.');
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
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64  = (b64 + padding).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from([...window.atob(base64)].map(c => c.charCodeAt(0)));
  }

  function showMsg(elId, type, text) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = `form-msg ${type}`; el.textContent = text; el.style.display = 'block';
    setTimeout(() => { el.style.display='none'; }, 5000);
  }

  // ── BOOT ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => init());

  // Expose admin helpers
  return { editUser, submitEditUser, loadUserList, toggleSuspend, toggleEAKey, regenEAKey };
})();
