'use strict';
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
      // Use candle dates (not report dates) so ALL days with data are navigable
      const r = await call('/api/candles/UK100?limit=5000');
      if (r?.candles?.length) {
        allDates = r.candles.map(x => x.date?.split('T')[0]).filter(Boolean).sort();
        const pk = el('dn-picker');
        if (pk && allDates.length) { pk.min = allDates[0]; pk.max = allDates[allDates.length-1]; }
      } else {
        // Fallback to report dates
        const rep = await call('/api/reports/UK100?limit=5000');
        if (rep?.length) {
          allDates = rep.map(x => x.report_date?.split('T')[0]).filter(Boolean).sort();
        }
      }
    } catch {}
  }

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
            <div class="cv-wick" style="height:${topW}px"></div>
            <div class="cv-body ${bias}" style="height:${bodyH}px"></div>
            <div class="cv-wick" style="height:${botW}px"></div>
          </div>
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
    const bf = el('backfill-btn');
    if (bf && !bf._bound) { bf._bound=true;
      bf.onclick = async () => {
        if (!confirm('This will classify all historical candles and generate a report for every trading day. Continue?')) return;
        bf.disabled=true;
        const statusEl = el('backfill-status');
        const symbols = ['UK100','DE30','XAUUSD','USOIL'];
        let totalReports = 0;
        for (const sym of symbols) {
          bf.textContent = `Processing ${sym}…`;
          if (statusEl) statusEl.innerHTML = `<div class="inline-load"><div class="spin-sm"></div><span style="color:var(--tx2);font-size:13px">Processing ${sym}…</span></div>`;
          try {
            const res = await call('/api/admin/backfill','POST',{symbol:sym});
            totalReports += res.generated || 0;
            if (statusEl) statusEl.innerHTML += `<div style="font-family:var(--fm);font-size:12px;color:var(--bu);padding:4px 0">✓ ${sym}: ${res.classified} classified, ${res.generated} reports generated</div>`;
          } catch(e) {
            if (statusEl) statusEl.innerHTML += `<div style="font-family:var(--fm);font-size:12px;color:var(--be);padding:4px 0">✗ ${sym}: ${e.message}</div>`;
          }
        }
        bf.disabled=false; bf.textContent='Generate All Reports';
        msg('backfill-msg','success',`✓ Done! ${totalReports} total reports generated. Go to Daily Reports and use ‹ › to navigate all dates.`);
      };
    }
    const bfsBtn = el('backfill-status-btn');
    if (bfsBtn && !bfsBtn._bound) { bfsBtn._bound=true;
      bfsBtn.onclick = async () => {
        const statusEl = el('backfill-status');
        if (!statusEl) return;
        statusEl.innerHTML = '<div class="inline-load"><div class="spin-sm"></div><span style="font-size:12px;color:var(--tx3)">Checking database…</span></div>';
        try {
          // Show what symbols are actually in the DB
          const dbSyms = await call('/api/admin/db-symbols');
          const status = await call('/api/admin/backfill-status');

          let html = '';
          // DB symbols section
          if (dbSyms.length) {
            html += `<div style="font-family:var(--fm);font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Data in database</div>`;
            html += dbSyms.map(r => `
              <div class="ds-row" style="margin-bottom:4px">
                <span class="ds-sym">${r.symbol}</span>
                <span class="ds-info">${r.candles} candles · ${r.from_date?.split('T')[0]||'?'} → ${r.to_date?.split('T')[0]||'?'}</span>
              </div>`).join('');
          } else {
            html += `<div style="color:var(--be);font-size:13px;padding:8px 0">⚠ No candle data in database yet. The EA must push data first.</div>`;
          }

          if (status.length) {
            html += `<div style="font-family:var(--fm);font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.8px;margin:12px 0 8px">Reports status</div>`;
            html += status.map(r => {
              const pct = r.total_candles > 0 ? Math.round((r.reports/r.total_candles)*100) : 0;
              const color = pct === 100 ? 'var(--bu)' : pct > 50 ? 'var(--vi3)' : 'var(--be)';
              return `<div class="ds-row" style="margin-bottom:4px;flex-direction:column;align-items:flex-start;gap:3px">
                <div style="display:flex;align-items:center;gap:8px;width:100%">
                  <span class="ds-sym">${r.symbol}</span>
                  <span style="font-family:var(--fm);font-size:11px;color:${color}">${r.reports}/${r.total_candles} reports (${pct}%)</span>
                </div>
                <div style="font-family:var(--fm);font-size:10px;color:var(--tx3)">
                  Reports: ${r.oldest_report?.split('T')[0]||'none'} → ${r.latest_report?.split('T')[0]||'none'}
                </div>
              </div>`;
            }).join('');
          }
          statusEl.innerHTML = html;
        } catch(e) { statusEl.innerHTML = `<p style="color:var(--be);font-size:13px">${e.message}</p>`; }
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
    await Promise.all([loadUserList(), loadEAKey()]);
  }

  async function loadUserList() {
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
  }

  async function unsubscribeNotifications() {
    try {
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(sub){await call('/api/push/unsubscribe','POST',{endpoint:sub.endpoint});await sub.unsubscribe();}
      updateNotifUI('unsubscribed');
    } catch {}
  }

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
})();
