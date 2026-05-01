'use strict';
<<<<<<< HEAD
/* ═══ KAIZOKU REPORTS ═══ */

const App = (() => {
  const SYM   = ['UK100','DE30','XAUUSD','USOIL'];
  const NAMES = { UK100:'FTSE 100', DE30:'DAX 40', XAUUSD:'Gold', USOIL:'US Crude' };
  const SEEN_OB_KEY = 'km_ob_seen';

  let token = null, user = null, vapidKey = null;
  let reportDate = null, allDates = [];
  let chartInited = {};

  // ── INIT ─────────────────────────────────────────────────
  async function init() {
    registerSW();
    setupInstall();
    updateDate();
    setInterval(updateDate, 60000);

    token = localStorage.getItem('km_token');
    user  = JSON.parse(localStorage.getItem('km_user') || 'null');

    // Tiny boot delay so CSS renders
    await sleep(350);
    hide('boot');

    if (token && user) {
      try { user = await call('/api/auth/me'); return showApp(); }
      catch { logout(false); }
    }

    // Show onboarding if first visit, else go straight to auth
    if (!localStorage.getItem(SEEN_OB_KEY)) {
      showOnboarding();
    } else {
      showAuth('login');
    }
  }

  // ── ONBOARDING ───────────────────────────────────────────
  function showOnboarding() {
    show('onboarding');
    document.getElementById('ob-start').onclick = () => {
      localStorage.setItem(SEEN_OB_KEY, '1');
      hide('onboarding');
      showAuth('signup');
    };
    document.getElementById('ob-skip').onclick = () => {
      localStorage.setItem(SEEN_OB_KEY, '1');
      hide('onboarding');
      showAuth('login');
    };
  }

  // ── AUTH ─────────────────────────────────────────────────
  function showAuth(tab = 'login') {
    show('auth');
    switchTab(tab);
    bindAuthForms();
    bindPasswordToggles();
    bindTabSwitcher();
  }

  function switchTab(tab) {
    qall('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    qall('.auth-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
    clearAuthMsgs();
  }

  function bindTabSwitcher() {
    qall('.auth-tab').forEach(t => {
      t.onclick = () => switchTab(t.dataset.tab);
    });
  }

  function bindPasswordToggles() {
    qall('.pw-eye').forEach(btn => {
      btn.onclick = () => {
        const inp = el(btn.dataset.for);
        if (!inp) return;
        inp.type = inp.type === 'password' ? 'text' : 'password';
        btn.textContent = inp.type === 'password' ? '👁' : '🙈';
      };
    });
  }

  function clearAuthMsgs() {
    qall('.auth-msg').forEach(e => e.style.display = 'none');
  }

  function bindAuthForms() {
    const lf = el('login-form');
    if (lf && !lf._bound) {
      lf._bound = true;
      lf.onsubmit = async e => {
        e.preventDefault();
        const btn = el('li-btn'), err = el('li-err');
        err.style.display = 'none'; btn.disabled = true; btn.textContent = 'Signing in…';
        try {
          const data = await call('/api/auth/login', 'POST',
            { login: el('li-login').value.trim(), password: el('li-pass').value }, false);
          saveSession(data); showApp();
        } catch(e) {
          err.textContent = e.message; err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Sign In';
        }
      };
    }

    const sf = el('signup-form');
    if (sf && !sf._bound) {
      sf._bound = true;
      sf.onsubmit = async e => {
        e.preventDefault();
        const btn = el('su-btn'), err = el('su-err');
        err.style.display = 'none'; btn.disabled = true; btn.textContent = 'Creating account…';
        try {
          const data = await call('/api/auth/signup', 'POST', {
            display_name: el('su-name').value.trim(),
            email:        el('su-email').value.trim(),
            username:     el('su-user').value.trim(),
            password:     el('su-pass').value,
          }, false);
          saveSession(data); showApp();
        } catch(e) {
          err.textContent = e.message; err.style.display = 'block';
          btn.disabled = false; btn.textContent = 'Create Account';
        }
      };
=======
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
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
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
<<<<<<< HEAD
    if (redirect) { hide('app'); showAuth('login'); }
  }

  // ── APP ──────────────────────────────────────────────────
  function showApp() {
    hide('auth'); hide('onboarding');
    show('app', 'flex');
    el('user-chip').textContent = user.display_name || user.username;
    const adminNav = el('nav-admin');
    if (adminNav) adminNav.style.display = user.role === 'admin' ? 'flex' : 'none';
    bindNav(); bindLogout(); bindSettings(); bindDateNav(); bindSidebar();
    loadReports(null); checkEA(); setInterval(checkEA, 90000);
    fetchVapidKey();
  }

  // ── NAV ──────────────────────────────────────────────────
  const PAGE_META = {
    reports:        { t:'Daily Reports',        s:'Latest candle analysis · All symbols' },
    'chart-UK100':  { t:'UK100 — FTSE 100',     s:'Daily candlestick chart' },
    'chart-DE30':   { t:'DE30 — DAX 40',        s:'Daily candlestick chart' },
    'chart-XAUUSD': { t:'XAUUSD — Gold',        s:'Daily candlestick chart' },
    'chart-USOIL':  { t:'USOIL — US Crude Oil', s:'Daily candlestick chart' },
    settings:       { t:'Settings',             s:'Profile · Notifications · Install' },
    admin:          { t:'Admin Panel',          s:'Users · EA Key · System' },
  };

  function bindNav() {
    qall('.nav-item[data-page]').forEach(n => {
      n.onclick = () => navTo(n.dataset.page);
    });
  }

  function navTo(pageId) {
    qall('.page').forEach(p => p.classList.remove('active'));
    qall('.nav-item').forEach(n => n.classList.remove('active'));
    el(`page-${pageId}`)?.classList.add('active');
    qs(`.nav-item[data-page="${pageId}"]`)?.classList.add('active');
    const m = PAGE_META[pageId] || { t:pageId, s:'' };
    el('tb-pg').textContent  = m.t;
    el('tb-sub').textContent = m.s;
    if (pageId.startsWith('chart-')) initChart(pageId.replace('chart-',''));
    if (pageId === 'admin')    loadAdmin();
    if (pageId === 'settings') loadSettings();
    closeSidebar(); window.scrollTo(0,0);
  }

  function bindSidebar() {
    el('hbtn').onclick = () => { el('sidebar').classList.toggle('open'); el('overlay').classList.toggle('open'); };
    el('overlay').onclick = closeSidebar;
  }
  function closeSidebar() { el('sidebar').classList.remove('open'); el('overlay').classList.remove('open'); }
  function bindLogout() { el('logout-btn').onclick = () => { if (confirm('Sign out?')) logout(); }; }

  // ── REPORTS ──────────────────────────────────────────────
  async function loadReports(date) {
    el('rpt-loading').style.display = 'flex';
    el('rpt-grid').style.display    = 'none';
    el('rpt-empty').style.display   = 'none';
    try {
      let rows;
      if (date) {
        rows = (await Promise.all(SYM.map(s => call(`/api/reports/${s}/${date}`).catch(() => null)))).filter(Boolean);
      } else {
        rows = await call('/api/reports/latest');
      }
      if (!rows?.length) { el('rpt-loading').style.display='none'; el('rpt-empty').style.display='flex'; updateDN(date); return; }
      reportDate = rows[0].report_date?.split('T')[0] || date;
      updateDN(reportDate);
      rows.forEach(r => { const e = el(`close-${r.symbol}`); if (e && r.close) e.textContent = fp(r.close,r.symbol); });
      const grid = el('rpt-grid');
      grid.innerHTML = '';
      rows.forEach(r => grid.appendChild(buildCard(r)));
      el('rpt-loading').style.display='none'; el('rpt-grid').style.display='grid';
      loadDates();
    } catch { el('rpt-loading').style.display='none'; el('rpt-empty').style.display='flex'; }
  }

  async function loadDates() {
    try {
      const r = await call('/api/reports/UK100?limit=500');
      if (r?.length) {
        allDates = r.map(x => x.report_date?.split('T')[0]).filter(Boolean).sort();
        const pk = el('dn-picker');
        if (pk && allDates.length) { pk.min = allDates[0]; pk.max = allDates[allDates.length-1]; }
=======
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
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
      }
    } catch {}
  }

<<<<<<< HEAD
  function updateDN(date) {
    const nav = el('date-nav'); if (!nav) return;
    nav.style.display = 'flex';
    el('dn-label').textContent = date
      ? new Date(date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long',year:'numeric'})
      : 'Latest Report';
    const pk = el('dn-picker'); if (pk) pk.value = date || '';
    const isLatest = !date || date === allDates[allDates.length-1];
    el('dn-latest').style.display = isLatest ? 'none' : 'inline-flex';
  }

  function bindDateNav() {
    el('dn-prev')?.addEventListener('click', () => stepDate(-1));
    el('dn-next')?.addEventListener('click', () => stepDate(+1));
    el('dn-latest')?.addEventListener('click', () => { reportDate=null; loadReports(null); });
    el('dn-picker')?.addEventListener('change', function() { if(this.value){reportDate=this.value;loadReports(this.value);} });
  }

  function stepDate(d) {
    if (!allDates.length) return;
    const cur = reportDate || allDates[allDates.length-1];
    const i = allDates.indexOf(cur); if (i===-1) return;
    const ni = i+d; if (ni<0||ni>=allDates.length) return;
    reportDate = allDates[ni]; loadReports(reportDate);
  }

  function buildCard(r) {
    const bias  = r.bias||'neutral';
    const pat   = (r.candle_type||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const lv    = typeof r.key_levels==='string' ? JSON.parse(r.key_levels) : r.key_levels||{};
    const emoji = {bullish:'▲',bearish:'▼',neutral:'↔'}[bias]||'↔';
    const conf  = r.bias_confidence ? `${r.bias_confidence}% confidence` : '';
    const range = (+lv.high||0)-(+lv.low||0);
    const bodyH = Math.max(6,Math.round(range>0?(+lv.body_high-+lv.body_low)/range*70:28));
    const topW  = Math.max(4,Math.round(range>0?((+lv.high||0)-(+lv.body_high||+lv.high||0))/range*70:14));
    const botW  = Math.max(4,Math.round(range>0?((+lv.body_low||+lv.low||0)-(+lv.low||0))/range*70:14));
    const cp    = range>0?Math.round(((+lv.close||0)-(+lv.low||0))/range*85):50;
    const ds    = new Date(r.report_date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const gt    = r.generated_at ? new Date(r.generated_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})+' UTC':'';
    let narr='';
    if (r.report_text) { const ai=r.report_text.indexOf('ANALYSIS\n'); narr=(ai>=0?r.report_text.slice(ai+9):r.short_summary||'').trim().slice(0,300)+'…'; }
    const d = document.createElement('div');
    d.className = 'rc';
    d.innerHTML=`
      <div class="rc-head">
        <div><div class="rc-sym">${r.symbol}</div><span class="rc-name">${NAMES[r.symbol]||r.symbol}</span></div>
        <div class="rc-bias ${bias}">${emoji} ${bias.charAt(0).toUpperCase()+bias.slice(1)}</div>
      </div>
      <div class="rc-body">
        <div class="cv-row">
          <div class="cv-candle">
=======
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
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
            <div class="cv-wick" style="height:${topW}px"></div>
            <div class="cv-body ${bias}" style="height:${bodyH}px"></div>
            <div class="cv-wick" style="height:${botW}px"></div>
          </div>
<<<<<<< HEAD
          <div class="cv-info"><h4>${pat||'—'}</h4><p>${r.structure_label?r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)+' · ':''}${conf}</p></div>
        </div>
        <div class="ohlc">
          <div class="ohlc-cell"><div class="ohlc-l">Open</div><div class="ohlc-v">${fp(lv.open,r.symbol)}</div></div>
          <div class="ohlc-cell"><div class="ohlc-l">High</div><div class="ohlc-v bear">${fp(lv.high,r.symbol)}</div></div>
          <div class="ohlc-cell"><div class="ohlc-l">Low</div><div class="ohlc-v bull">${fp(lv.low,r.symbol)}</div></div>
          <div class="ohlc-cell"><div class="ohlc-l">Close</div><div class="ohlc-v ${bias==='bullish'?'bull':bias==='bearish'?'bear':''}">${fp(lv.close,r.symbol)}</div></div>
          <div class="ohlc-cell" style="border-color:var(--vig);background:var(--vib2)"><div class="ohlc-l" style="color:var(--vi3)">Body High</div><div class="ohlc-v vi">${fp(lv.body_high,r.symbol)}</div></div>
          <div class="ohlc-cell" style="border-color:var(--vig);background:var(--vib2)"><div class="ohlc-l" style="color:var(--vi3)">Body Low</div><div class="ohlc-v vi">${fp(lv.body_low,r.symbol)}</div></div>
        </div>
        <div class="levels">
          <div class="lv-title">Session Range</div>
          <div class="lv-row"><div class="lv-lbl">High</div><div class="lv-track"><div class="lv-fill h" style="width:90%"></div></div><div class="lv-price">${fp(lv.high,r.symbol)}</div></div>
          <div class="lv-row"><div class="lv-lbl">Close</div><div class="lv-track"><div class="lv-fill c" style="width:${cp}%"></div></div><div class="lv-price">${fp(lv.close,r.symbol)}</div></div>
          <div class="lv-row"><div class="lv-lbl">Low</div><div class="lv-track"><div class="lv-fill l" style="width:10%"></div></div><div class="lv-price">${fp(lv.low,r.symbol)}</div></div>
        </div>
        ${narr?`<div class="rc-text"><div class="rc-text-lbl">Analysis</div><div class="rc-text-body">${narr}</div></div>`:''}
      </div>
      <div class="rc-foot">
        <span class="rc-ts">${ds}${gt?' · '+gt:''}</span>
        ${r.structure_label?`<span class="rc-struct ${r.structure_label}">${r.structure_label.charAt(0).toUpperCase()+r.structure_label.slice(1)}</span>`:''}
      </div>`;
    return d;
  }

  // ── CHARTS ───────────────────────────────────────────────
  async function initChart(symbol) {
    if (chartInited[symbol]) return;
    const page = el(`page-chart-${symbol}`); if (!page) return;
    const host = page.querySelector('.chart-host');
    host.innerHTML=`
      <div class="chart-bar">
        <div><div class="chart-sym">${symbol}</div><div style="font-size:11.5px;color:var(--tx2)">${NAMES[symbol]||symbol}</div></div>
        <div class="range-group">${['1M','3M','6M','1Y','2Y','ALL'].map(r=>`<button class="rbtn${r==='1Y'?' on':''}" data-r="${r}">${r}</button>`).join('')}</div>
      </div>
      <div id="chart-${symbol}" style="flex:1;border-radius:var(--r2);overflow:hidden;background:var(--s1);border:1px solid var(--bd)"></div>`;
    host.querySelectorAll('.rbtn').forEach(b => {
      b.onclick = () => { host.querySelectorAll('.rbtn').forEach(x=>x.classList.remove('on')); b.classList.add('on'); KaizokuCharts.setRange(symbol,{'1M':30,'3M':90,'6M':180,'1Y':365,'2Y':730,'ALL':9999}[b.dataset.r]); };
    });
    try {
      const res = await call(`/api/candles/${symbol}?limit=5000`);
      KaizokuCharts.initChart(symbol, `chart-${symbol}`, res.candles);
      chartInited[symbol] = true;
    } catch {
      host.innerHTML += `<div class="state-empty"><div class="se-icon">◫</div><h3>No data yet</h3><p>The EA has not sent data for ${symbol}.</p></div>`;
    }
  }

  // ── EA STATUS ────────────────────────────────────────────
  async function checkEA() {
    try {
      const res = await call('/api/candles/', 'GET', null, true, 5000);
      const led = el('ea-led'), txt = el('ea-txt'), sub = el('ea-sub');
      if (res?.length) {
        led.className = 'ea-led on'; txt.textContent = 'EA Connected';
        const latest = [...res].sort((a,b)=>new Date(b.to_date)-new Date(a.to_date))[0];
        sub.textContent = `Last: ${new Date(latest.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}`;
      } else {
        led.className = 'ea-led err'; txt.textContent = 'No data yet'; sub.textContent = 'Connect EA';
      }
    } catch {
      el('ea-led').className = 'ea-led err'; el('ea-txt').textContent = 'Offline';
    }
  }

  // ── SETTINGS ─────────────────────────────────────────────
  function loadSettings() {
    const emailEl = el('pf-email'), userEl = el('pf-user'), nameEl = el('pf-name');
    if (emailEl) emailEl.value = user.email||'';
    if (userEl)  userEl.value  = user.username||'';
    if (nameEl)  nameEl.value  = user.display_name||'';
    updateNotifUI(); loadDataStatus();
  }

  function bindSettings() {
    const pf = el('prof-form');
    if (pf && !pf._bound) { pf._bound=true;
      pf.onsubmit = async e => {
        e.preventDefault();
        try {
          const upd = await call('/api/auth/profile','PATCH',{ email:el('pf-email')?.value.trim()||null, username:el('pf-user').value.trim(), display_name:el('pf-name').value.trim() });
          user={...user,...upd}; localStorage.setItem('km_user',JSON.stringify(user));
          el('user-chip').textContent = user.display_name||user.username;
          msg('pf-msg','success','✓ Profile saved.');
        } catch(e){ msg('pf-msg','error',e.message); }
      };
    }
    const pw = el('pw-form');
    if (pw && !pw._bound) { pw._bound=true;
      pw.onsubmit = async e => {
        e.preventDefault();
        if (el('pw-new').value.length<8){msg('pw-msg','error','Min 8 characters.');return;}
        try { await call('/api/auth/change-password','POST',{current_password:el('pw-cur').value,new_password:el('pw-new').value}); msg('pw-msg','success','✓ Password changed.'); pw.reset(); }
        catch(e){msg('pw-msg','error',e.message);}
      };
    }
    el('notif-btn').onclick = () => navTo('settings');
    const rj = el('run-jobs');
    if (rj && !rj._bound) { rj._bound=true;
      rj.onclick = async () => {
        rj.disabled=true; rj.textContent='Running…';
        try { await call('/api/admin/run-jobs','POST'); msg('jobs-msg','success','✓ Jobs started — check back in 2 minutes.'); }
        catch(e){msg('jobs-msg','error',e.message);}
        finally{setTimeout(()=>{rj.disabled=false;rj.textContent='Run Nightly Jobs Now';},4000);}
      };
    }
  }

  async function loadDataStatus() {
    const d = el('data-status'); if (!d) return;
    try {
      const res = await call('/api/candles/');
      d.innerHTML = res?.length
        ? res.map(s=>`<div class="ds-row"><span class="ds-sym">${s.symbol}</span><span class="ds-info">${s.total_candles} candles · Latest: ${new Date(s.to_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span></div>`).join('')
        : '<p style="font-size:13px;color:var(--tx3)">No data received yet.</p>';
    } catch {}
  }

  // ── ADMIN ────────────────────────────────────────────────
  async function loadAdmin() {
=======
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
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
    await Promise.all([loadUserList(), loadEAKey()]);
  }

  async function loadUserList() {
<<<<<<< HEAD
    const c = el('user-list'); if (!c) return;
    c.innerHTML = '<div class="inline-load"><div class="spin-sm"></div></div>';
    try {
      const users = await call('/api/admin/users');
      c.innerHTML = users.map(u=>`
        <div class="user-row" id="ur-${u.id}">
          <div class="ur-left">
            <div class="ur-name">${u.display_name||u.username}</div>
            <div class="ur-meta">
              <span class="ur-user">@${u.username}</span>
              <span class="ur-tag ${u.role==='admin'?'admin':''}">${u.role==='admin'?'Admin':'User'}</span>
              ${u.status==='suspended'?'<span class="ur-tag sus">Suspended</span>':''}
              ${u.last_login?`<span class="ur-last">${new Date(u.last_login).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>`:''}
            </div>
          </div>
          <div class="ur-actions">
            <button class="btn-sm" onclick="App.editUser(${u.id})">Edit</button>
            ${u.id!==user.id?`<button class="btn-sm dng" onclick="App.toggleSuspend(${u.id},'${u.status||'active'}','${u.username}')">${u.status==='suspended'?'Restore':'Suspend'}</button>`:''}
          </div>
        </div>`).join('') + `<p style="font-family:var(--fm);font-size:11px;color:var(--tx3);margin-top:12px">${users.length} user${users.length!==1?'s':''}. New users sign up at the app URL.</p>`;
    } catch(e){c.innerHTML=`<p style="color:var(--be);font-size:13px">${e.message}</p>`;}
  }

  function editUser(id) {
    const row = el(`ur-${id}`); if (!row) return;
    const orig = row.innerHTML;
    row.innerHTML = `<div style="width:100%">
      <div class="inline-form" style="margin-bottom:0">
        <div class="field-row" style="margin-bottom:12px">
          <div class="field"><label>Display Name</label><input id="ed-name-${id}" type="text"></div>
          <div class="field"><label>Role</label>
            <select id="ed-role-${id}">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin-bottom:12px"><label>Email</label><input id="ed-email-${id}" type="email"></div>
        <div class="field" style="margin-bottom:12px"><label>New Password (leave blank to keep)</label><input id="ed-pass-${id}" type="password" autocomplete="new-password" placeholder="Optional"></div>
        <div id="ed-msg-${id}" class="form-msg" style="display:none"></div>
        <div style="display:flex;gap:8px">
          <button class="btn-vi" style="flex:1" onclick="App.saveEditUser(${id})">Save</button>
          <button class="btn-outline" onclick="App.loadUserList()">Cancel</button>
        </div>
      </div></div>`;
    // Pre-fill from DOM (re-fetch to get current values)
    call('/api/admin/users').then(users => {
      const u = users.find(x => x.id === id); if (!u) return;
      const n=el(`ed-name-${id}`), r=el(`ed-role-${id}`), em=el(`ed-email-${id}`);
      if(n) n.value=u.display_name||u.username;
      if(r) r.value=u.role||'user';
      if(em) em.value=u.email||'';
    }).catch(()=>{});
  }

  async function saveEditUser(id) {
    const body={};
    const n=el(`ed-name-${id}`),r=el(`ed-role-${id}`),em=el(`ed-email-${id}`),p=el(`ed-pass-${id}`);
    if(n?.value.trim()) body.display_name=n.value.trim();
    if(r?.value) body.role=r.value;
    if(em?.value.trim()) body.email=em.value.trim();
    if(p?.value){if(p.value.length<8){msg(`ed-msg-${id}`,'error','Password min 8 chars.');return;}body.password=p.value;}
    try { await call(`/api/admin/users/${id}`,'PATCH',body); if(id===user.id&&body.display_name){user.display_name=body.display_name;el('user-chip').textContent=user.display_name;localStorage.setItem('km_user',JSON.stringify(user));} loadUserList(); }
    catch(e){msg(`ed-msg-${id}`,'error',e.message);}
  }

  async function toggleSuspend(id, status, username) {
    const ns = status==='suspended'?'active':'suspended';
    if(!confirm(`${ns==='suspended'?'Suspend':'Restore'} @${username}?`)) return;
    try { await call(`/api/admin/users/${id}`,'PATCH',{status:ns}); loadUserList(); }
    catch(e){alert(e.message);}
  }

  async function loadEAKey() {
    const c = el('ea-key-wrap'); if (!c) return;
    try {
      const r = await call('/api/admin/ea-key');
      c._key = r.ea_key; c._vis = false;
      c.innerHTML=`<div class="ea-key-card">
        <div class="ek-label">EA API Key</div>
        <div class="ek-val" id="ek-val">${'•'.repeat(48)}</div>
        <div class="ek-btns">
          <button class="btn-sm" onclick="App.toggleKey()">Show / Hide</button>
          <button class="btn-sm dng" onclick="App.regenKey()">Regenerate</button>
        </div>
        <div class="ek-hint">Set this in MetaTrader 5 → EA Inputs → <strong style="color:var(--tx)">InpApiKey</strong></div>
      </div>`;
    } catch(e){c.innerHTML=`<p style="color:var(--be);font-size:13px">${e.message}</p>`;}
  }

  function toggleKey() {
    const c=el('ea-key-wrap'),v=el('ek-val');
    if(!c||!v||!c._key) return;
    c._vis=!c._vis; v.textContent=c._vis?c._key:'•'.repeat(48); v.style.wordBreak='break-all';
  }

  async function regenKey() {
    if(!confirm('Regenerate? Update InpApiKey in MetaTrader 5 afterwards.')) return;
    try { const r=await call('/api/admin/ea-key/regenerate','POST'); const c=el('ea-key-wrap'),v=el('ek-val'); if(c){c._key=r.ea_key;c._vis=true;} if(v){v.textContent=r.ea_key;v.style.wordBreak='break-all';} }
    catch(e){alert(e.message);}
  }

  // ── PUSH ─────────────────────────────────────────────────
  async function fetchVapidKey() {
    try { const r=await call('/api/push/key','GET',null,false); vapidKey=r.key; updateNotifUI(); } catch {}
  }

  async function subscribeNotifications() {
    if(!('PushManager' in window)){alert('Push not supported in this browser.');return;}
    const p=await Notification.requestPermission(); if(p!=='granted'){updateNotifUI('denied');return;}
    try {
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(vapidKey)});
      await call('/api/push/subscribe','POST',{subscription:sub.toJSON(),label:navigator.platform||'Browser'});
      updateNotifUI('subscribed');
    } catch(e){alert('Notifications error: '+e.message);}
=======
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
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
  }

  async function unsubscribeNotifications() {
    try {
<<<<<<< HEAD
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(sub){await call('/api/push/unsubscribe','POST',{endpoint:sub.endpoint});await sub.unsubscribe();}
=======
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api('/api/push/unsubscribe','POST',{endpoint:sub.endpoint}); await sub.unsubscribe(); }
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
      updateNotifUI('unsubscribed');
    } catch {}
  }

<<<<<<< HEAD
  async function updateNotifUI(state=null) {
    const box=el('notif-box'),btn=el('notif-toggle'); if(!box||!btn) return;
    if(!('Notification' in window)){box.textContent='Notifications not supported.';btn.style.display='none';return;}
    if(!vapidKey){box.textContent='Push not yet configured — add VAPID keys to Netlify Variables.';btn.style.display='none';return;}
    const reg=await navigator.serviceWorker?.ready;
    const sub=reg?await reg.pushManager.getSubscription():null;
    if(sub||state==='subscribed'){
      box.textContent='✓ Enabled — you will receive daily report notifications.';
      btn.textContent='Disable';btn.onclick=unsubscribeNotifications;
    } else if(Notification.permission==='denied'||state==='denied'){
      box.textContent='Blocked — enable in browser settings.';btn.style.display='none';
    } else {
      box.textContent='Not enabled. Click below to receive daily report alerts.';
      btn.textContent='Enable Notifications';btn.onclick=subscribeNotifications;
    }
  }

  // ── PWA ──────────────────────────────────────────────────
  let deferredPrompt=null;
  function setupInstall() {
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;const b=el('install-btn');if(b)b.style.display='block';});
    el('install-btn')?.addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;});
    if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.matchMedia('(display-mode:standalone)').matches){const n=el('install-note');if(n){n.textContent='iPhone/iPad: tap Share → Add to Home Screen.';n.style.display='block';}}
  }

  function registerSW() {
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

  // ── UTILS ────────────────────────────────────────────────
  function updateDate(){const e=el('tb-date');if(e)e.textContent=new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
  function el(id){return document.getElementById(id);}
  function qs(sel){return document.querySelector(sel);}
  function qall(sel){return document.querySelectorAll(sel);}
  function show(id,d='block'){const e=el(id);if(e)e.style.display=d;}
  function hide(id){const e=el(id);if(e)e.style.display='none';}

  function msg(id,type,text){
    const e=el(id);if(!e)return;
    e.className=`form-msg ${type}`;e.textContent=text;e.style.display='block';
    setTimeout(()=>e.style.display='none',5000);
  }

  function fp(v,sym){
    if(!v&&v!==0)return'—';const n=+v;
    if(sym==='XAUUSD')return n.toFixed(2);
    if(sym==='USOIL')return n.toFixed(3);
    return n>=1000?n.toFixed(2):n.toFixed(4);
  }

  function b64(s){
    const p='='.repeat((4-s.length%4)%4);
    const base64=(s+p).replace(/-/g,'+').replace(/_/g,'/');
    return Uint8Array.from([...window.atob(base64)].map(c=>c.charCodeAt(0)));
  }

  async function call(path,method='GET',body=null,auth=true,timeout=10000){
    const h={'Content-Type':'application/json'};
    if(auth&&token)h['Authorization']=`Bearer ${token}`;
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),timeout);
    try {
      const res=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined,signal:ctrl.signal});
      clearTimeout(t);
      if((res.status===401||res.status===403)&&auth){logout();throw new Error('Session expired.');}
      const d=await res.json();
      if(!res.ok)throw new Error(d.error||`Error ${res.status}`);
      return d;
    } catch(e){clearTimeout(t);if(e.name==='AbortError')throw new Error('Request timed out.');throw e;}
  }

  document.addEventListener('DOMContentLoaded', init);

  return { editUser, saveEditUser, loadUserList, toggleSuspend, toggleKey, regenKey };
=======
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
>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
})();
