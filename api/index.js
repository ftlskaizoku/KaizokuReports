'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query, initDb }                          = require('../lib/db');
const { classifyCandle, classifyOutcome }         = require('../lib/classifier');
const { generateReport, refreshPatternStats }     = require('../lib/reporter');
const { subscribe, unsubscribe, sendReportNotifications, vapidPublicKey } = require('../lib/push');
const { getEAKey, regenerateEAKey }              = require('../lib/settings');

// ── DB init once per cold start ──
let dbReady = false;
async function ensureDb() {
  if (!dbReady) { await initDb(); dbReady = true; }
}

// ── Helpers ──
function jsonRes(res, status, data) {
  res.status(status).json(data);
}

function getToken(req) {
  return (req.headers.authorization || '').split(' ')[1] || null;
}

function verifyToken(token) {
  if (!token) throw { status: 401, message: 'Not authenticated.' };
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { throw { status: 403, message: 'Invalid or expired token.' }; }
}

async function verifyEAKey(req) {
  const key = req.headers['x-api-key'];
  if (!key) throw { status: 401, message: 'Missing X-Api-Key.' };
  const valid = await getEAKey();
  if (key !== valid) throw { status: 401, message: 'Invalid EA key.' };
}

const SYM   = ['UK100','DE30','GER30','XAUUSD','USOIL'];
const ALIAS = { GER30:'DE30',GER40:'DE30',DE40:'DE30',DAX:'DE30',DAX40:'DE30',FTSE:'UK100',FTSE100:'UK100',GOLD:'XAUUSD',WTI:'USOIL',OIL:'USOIL',CRUDE:'USOIL','USOIL+':'USOIL' };
const normSym = s => { const u=(s||'').toUpperCase().replace(/[^A-Z0-9+]/g,''); return ALIAS[u]||(SYM.includes(u)?u:null); };

const SYMBOLS = ['UK100','DE30','XAUUSD','USOIL'];

// ════════════════════════════════════════════════
// MAIN HANDLER — Vercel calls this for every /api/* request
// ════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Api-Key,X-Cron-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Guard: DATABASE_URL
  if (!process.env.DATABASE_URL) {
    return jsonRes(res, 503, {
      error: 'DATABASE_URL not set',
      fix: 'Vercel → Project Settings → Environment Variables → Add DATABASE_URL (get from neon.tech)'
    });
  }

  // Guard: JWT_SECRET
  if (!process.env.JWT_SECRET && !req.url.includes('/ea/')) {
    return jsonRes(res, 503, { error: 'JWT_SECRET not set in Vercel Environment Variables.' });
  }

  try {
    await ensureDb();
    await route(req, res);
  } catch (err) {
    if (err.status) return jsonRes(res, err.status, { error: err.message });
    console.error('Unhandled error:', err);
    jsonRes(res, 500, { error: 'Server error.' });
  }
};

async function route(req, res) {
  const url    = req.url.replace(/^\/api/, '').split('?')[0];
  const method = req.method;
  const body   = req.body || {};

  // ── AUTH ──────────────────────────────────────────────────────
  if (method === 'POST' && url === '/auth/signup') {
    const { username, email, password, display_name } = body;
    if (!username?.trim() || username.trim().length < 2)
      return jsonRes(res, 400, { error: 'Username must be at least 2 characters.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return jsonRes(res, 400, { error: 'A valid email is required.' });
    if (!password || password.length < 8)
      return jsonRes(res, 400, { error: 'Password must be at least 8 characters.' });

    const cnt = await query('SELECT COUNT(*) AS c FROM users');
    const isFirst = parseInt(cnt.rows[0].c) === 0;
    const hash = await bcrypt.hash(password, 12);
    try {
      const r = await query(
        `INSERT INTO users (username,email,password_hash,display_name,role)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,username,email,display_name,role`,
        [username.toLowerCase().trim(), email.toLowerCase().trim(), hash, display_name?.trim()||username, isFirst?'admin':'user']
      );
      const user = r.rows[0];
      const token = jwt.sign({ id:user.id, username:user.username, role:user.role }, process.env.JWT_SECRET, { expiresIn:'30d' });
      return jsonRes(res, 200, { token, user });
    } catch(e) {
      if (e.code === '23505') return jsonRes(res, 400, { error: 'Username or email already registered.' });
      throw e;
    }
  }

  if (method === 'POST' && url === '/auth/login') {
    const id = (body.login||body.email||body.username||'').trim().toLowerCase();
    const { password } = body;
    if (!id||!password) return jsonRes(res, 400, { error: 'Email/username and password required.' });
    const r = await query(
      `SELECT * FROM users WHERE (LOWER(email)=$1 OR LOWER(username)=$1) AND (status IS NULL OR status='active') LIMIT 1`,
      [id]
    );
    if (!r.rows.length) return jsonRes(res, 401, { error: 'Invalid credentials.' });
    const user = r.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return jsonRes(res, 401, { error: 'Invalid credentials.' });
    await query(`UPDATE users SET last_login=NOW() WHERE id=$1`, [user.id]);
    const token = jwt.sign({ id:user.id, username:user.username, role:user.role }, process.env.JWT_SECRET, { expiresIn:'30d' });
    return jsonRes(res, 200, { token, user:{ id:user.id, username:user.username, email:user.email, display_name:user.display_name, role:user.role } });
  }

  if (method === 'GET' && url === '/auth/me') {
    const user = verifyToken(getToken(req));
    const r = await query(`SELECT id,username,email,display_name,role,last_login FROM users WHERE id=$1`, [user.id]);
    if (!r.rows.length) return jsonRes(res, 404, { error: 'User not found.' });
    return jsonRes(res, 200, r.rows[0]);
  }

  if (method === 'POST' && url === '/auth/change-password') {
    const user = verifyToken(getToken(req));
    const { current_password, new_password } = body;
    if (!current_password||!new_password) return jsonRes(res, 400, { error: 'Both passwords required.' });
    if (new_password.length < 8) return jsonRes(res, 400, { error: 'Min 8 characters.' });
    const r = await query(`SELECT password_hash FROM users WHERE id=$1`, [user.id]);
    if (!await bcrypt.compare(current_password, r.rows[0].password_hash)) return jsonRes(res, 401, { error: 'Current password incorrect.' });
    await query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [await bcrypt.hash(new_password,12), user.id]);
    return jsonRes(res, 200, { message: 'Password changed.' });
  }

  if (method === 'PATCH' && url === '/auth/profile') {
    const user = verifyToken(getToken(req));
    const { username, display_name, email } = body;
    const sets=[],params=[];let i=1;
    if (display_name!==undefined){sets.push(`display_name=$${i++}`);params.push(display_name.trim());}
    if (username!==undefined){if(username.trim().length<2)return jsonRes(res,400,{error:'Username too short.'});sets.push(`username=$${i++}`);params.push(username.toLowerCase().trim());}
    if (email!==undefined){sets.push(`email=$${i++}`);params.push(email?email.toLowerCase().trim():null);}
    if (!sets.length) return jsonRes(res, 400, { error: 'Nothing to update.' });
    params.push(user.id);
    try {
      const r = await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,username,email,display_name,role`, params);
      return jsonRes(res, 200, r.rows[0]);
    } catch(e) {
      if (e.code==='23505') return jsonRes(res, 400, { error: 'Username or email already taken.' });
      throw e;
    }
  }

  // ── ADMIN ─────────────────────────────────────────────────────
  if (method === 'GET' && url === '/admin/users') {
    const user = verifyToken(getToken(req));
    if (user.role !== 'admin') return jsonRes(res, 403, { error: 'Admin only.' });
    const r = await query(`SELECT id,username,email,display_name,role,status,last_login,created_at FROM users ORDER BY id`);
    return jsonRes(res, 200, r.rows);
  }

  const adminUserMatch = url.match(/^\/admin\/users\/(\d+)$/);
  if (adminUserMatch) {
    const user = verifyToken(getToken(req));
    if (user.role !== 'admin') return jsonRes(res, 403, { error: 'Admin only.' });
    const uid = adminUserMatch[1];
    if (method === 'PATCH') {
      const { display_name, password, role, email, status } = body;
      const sets=[],params=[];let i=1;
      if(display_name!==undefined){sets.push(`display_name=$${i++}`);params.push(display_name);}
      if(role!==undefined){sets.push(`role=$${i++}`);params.push(role==='admin'?'admin':'user');}
      if(email!==undefined){sets.push(`email=$${i++}`);params.push(email?.toLowerCase().trim()||null);}
      if(status!==undefined){sets.push(`status=$${i++}`);params.push(status==='suspended'?'suspended':'active');}
      if(password){if(password.length<8)return jsonRes(res,400,{error:'Min 8 chars.'});sets.push(`password_hash=$${i++}`);params.push(await bcrypt.hash(password,12));}
      if(!sets.length)return jsonRes(res,400,{error:'Nothing to update.'});
      params.push(uid);
      const r=await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,username,email,display_name,role,status`,params);
      if(!r.rows.length)return jsonRes(res,404,{error:'Not found.'});
      return jsonRes(res,200,{message:'Updated.',user:r.rows[0]});
    }
    if (method === 'DELETE') {
      if (parseInt(uid)===user.id) return jsonRes(res,400,{error:'Cannot delete yourself.'});
      const r=await query(`DELETE FROM users WHERE id=$1 RETURNING username`,[uid]);
      if(!r.rows.length)return jsonRes(res,404,{error:'Not found.'});
      return jsonRes(res,200,{message:'Removed @'+r.rows[0].username});
    }
  }

  if (method === 'GET' && url === '/admin/ea-key') {
    const user = verifyToken(getToken(req));
    if (user.role !== 'admin') return jsonRes(res, 403, { error: 'Admin only.' });
    return jsonRes(res, 200, { ea_key: await getEAKey() });
  }

  if (method === 'POST' && url === '/admin/ea-key/regenerate') {
    const user = verifyToken(getToken(req));
    if (user.role !== 'admin') return jsonRes(res, 403, { error: 'Admin only.' });
    return jsonRes(res, 200, { ea_key: await regenerateEAKey() });
  }

  if (method === 'POST' && url === '/admin/run-jobs') {
    const user = verifyToken(getToken(req));
    if (user.role !== 'admin') return jsonRes(res, 403, { error: 'Admin only.' });
    jsonRes(res, 200, { message: 'Jobs started.' });
    setImmediate(() => runNightlyJobs().catch(console.error));
    return;
  }

  // ── EA ────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/ea/push') {
    await verifyEAKey(req);
    const candles = Array.isArray(body) ? body : [body];
    if (!candles.length) return jsonRes(res, 400, { error: 'Empty.' });
    let ins=0,upd=0,skip=0;
    for (const c of candles) {
      const sym = normSym(c.symbol);
      if (!sym||!c.date||isNaN(+c.open)||isNaN(+c.high)||isNaN(+c.low)||isNaN(+c.close)){skip++;continue;}
      const r = await query(
        `INSERT INTO candles (symbol,candle_date,open,high,low,close,volume) VALUES ($1,$2::date,$3,$4,$5,$6,$7)
         ON CONFLICT (symbol,candle_date) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,updated_at=NOW()
         RETURNING (xmax=0) AS ins`,
        [sym,c.date,+c.open,+c.high,+c.low,+c.close,+(c.volume||0)]
      ).catch(()=>null);
      if(r?.rows[0]?.ins)ins++;else if(r)upd++;else skip++;
    }
    return jsonRes(res, 200, { inserted:ins, updated:upd, skipped:skip });
  }

  if (method === 'GET' && url === '/ea/status') {
    await verifyEAKey(req);
    const r = await query(`SELECT symbol,COUNT(*) total,MAX(candle_date) latest FROM candles GROUP BY symbol ORDER BY symbol`);
    return jsonRes(res, 200, { status:'connected', symbols:r.rows });
  }

  // ── CANDLES ───────────────────────────────────────────────────
  if (method === 'GET' && url === '/candles/') {
    verifyToken(getToken(req));
    const r = await query(`SELECT c.symbol,COUNT(*) total_candles,MIN(c.candle_date) from_date,MAX(c.candle_date) to_date,c2.close latest_close,ca.d1_bias latest_bias FROM candles c LEFT JOIN candles c2 ON c2.symbol=c.symbol AND c2.candle_date=(SELECT MAX(candle_date) FROM candles WHERE symbol=c.symbol) LEFT JOIN candle_analysis ca ON ca.candle_id=c2.id GROUP BY c.symbol,c2.close,ca.d1_bias ORDER BY c.symbol`);
    return jsonRes(res, 200, r.rows);
  }

  const candlesMatch = url.match(/^\/candles\/([A-Z0-9]+)$/);
  if (method === 'GET' && candlesMatch) {
    verifyToken(getToken(req));
    const sym = candlesMatch[1];
    const params = new URLSearchParams(req.url.split('?')[1]||'');
    const limit = Math.min(parseInt(params.get('limit')||'500'),5000);
    const from = params.get('from'), to = params.get('to');
    let q=`SELECT candle_date,open,high,low,close,volume FROM candles WHERE symbol=$1`,p=[sym],i=2;
    if(from){q+=` AND candle_date>=$${i++}::date`;p.push(from);}
    if(to){q+=` AND candle_date<=$${i++}::date`;p.push(to);}
    q+=` ORDER BY candle_date DESC LIMIT $${i}`;p.push(limit);
    const r = await query(q,p);
    return jsonRes(res, 200, { symbol:sym, count:r.rows.length, candles:r.rows.reverse().map(c=>({date:c.candle_date,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume})) });
  }

  // ── REPORTS ───────────────────────────────────────────────────
  if (method === 'GET' && url === '/reports/latest') {
    verifyToken(getToken(req));
    const r = await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.report_date=(SELECT MAX(report_date) FROM daily_reports) ORDER BY r.symbol`);
    return jsonRes(res, 200, r.rows);
  }

  const reportSymMatch = url.match(/^\/reports\/([A-Z0-9]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (method === 'GET' && reportSymMatch) {
    verifyToken(getToken(req));
    const r = await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 AND r.report_date=$2::date`,[reportSymMatch[1],reportSymMatch[2]]);
    if (!r.rows.length) return jsonRes(res, 404, { error: 'Report not found.' });
    return jsonRes(res, 200, r.rows[0]);
  }

  const reportHistMatch = url.match(/^\/reports\/([A-Z0-9]+)$/);
  if (method === 'GET' && reportHistMatch) {
    verifyToken(getToken(req));
    const sym = reportHistMatch[1];
    const params = new URLSearchParams(req.url.split('?')[1]||'');
    const limit = Math.min(parseInt(params.get('limit')||'60'),365);
    const r = await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 ORDER BY r.report_date DESC LIMIT $2`,[sym,limit]);
    return jsonRes(res, 200, r.rows);
  }

  // ── PUSH ──────────────────────────────────────────────────────
  if (method === 'GET' && url === '/push/key') return jsonRes(res, 200, { key: vapidPublicKey() });

  if (method === 'POST' && url === '/push/subscribe') {
    const user = verifyToken(getToken(req));
    await subscribe(user.id, body.subscription, body.label);
    return jsonRes(res, 200, { ok: true });
  }
  if (method === 'POST' && url === '/push/unsubscribe') {
    verifyToken(getToken(req));
    await unsubscribe(body.endpoint);
    return jsonRes(res, 200, { ok: true });
  }

  // ── CRON ──────────────────────────────────────────────────────
  if (method === 'POST' && url === '/cron/nightly') {
    const secret = req.headers['x-cron-secret'] || body?.secret;
    if (!secret || secret !== process.env.CRON_SECRET) return jsonRes(res, 401, { error: 'Unauthorized.' });
    jsonRes(res, 200, { message: 'Jobs started.' });
    setImmediate(() => runNightlyJobs().catch(console.error));
    return;
  }

  // ── HEALTH ────────────────────────────────────────────────────
  if (url === '/health') return jsonRes(res, 200, { ok: true, time: new Date().toISOString() });

  return jsonRes(res, 404, { error: `No route: ${method} ${url}` });
}

// ════════════════════════════════════════════════
// NIGHTLY JOBS
// ════════════════════════════════════════════════
async function runNightlyJobs() {
  console.log('▶ Nightly jobs');
  for (const sym of SYMBOLS) {
    try { await classifyLatest(sym); } catch(e) { console.error('Classify', sym, e.message); }
  }
  for (const sym of SYMBOLS) {
    try { await refreshPatternStats(sym); } catch(e) { console.error('Stats', sym, e.message); }
  }
  const reports = [];
  for (const sym of SYMBOLS) {
    try {
      const r = await query(`SELECT c.*,ca.candle_type,ca.structure_label,ca.d1_bias,ca.bias_confidence FROM candles c JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 1`,[sym]);
      if (!r.rows.length) continue;
      const row = r.rows[0];
      const rep = await generateReport(sym, row, { candle_type:row.candle_type, structure_label:row.structure_label, d1_bias:row.d1_bias, bias_confidence:row.bias_confidence });
      await query(`INSERT INTO daily_reports (symbol,report_date,candle_id,candle_type,bias,bias_confidence,key_levels,report_text,short_summary,generated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (symbol,report_date) DO UPDATE SET candle_type=$4,bias=$5,bias_confidence=$6,key_levels=$7,report_text=$8,short_summary=$9,generated_at=NOW()`,
        [sym,row.candle_date,row.id,rep.candle_type,rep.bias,rep.bias_confidence,JSON.stringify(rep.key_levels),rep.report_text,rep.short_summary]);
      reports.push(rep);
    } catch(e) { console.error('Report', sym, e.message); }
  }
  await sendReportNotifications(reports).catch(console.error);
  console.log('✓ Done —', reports.length, 'reports');
}

async function classifyLatest(symbol) {
  const res = await query(`SELECT c.*,ca.candle_type,ca.d1_bias,ca.structure_label,ca.id AS aid FROM candles c LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 22`,[symbol]);
  if (!res.rows.length) return;
  const [today,...rest] = res.rows;
  if (!today.aid) {
    const analysis = classifyCandle(today, rest[0]||null, rest.slice(0,20).reverse());
    await query(`INSERT INTO candle_analysis (candle_id,symbol,candle_date,candle_type,structure_label,body_pct,upper_wick_pct,lower_wick_pct,close_position,range_points,body_points,d1_bias,bias_confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (candle_id) DO NOTHING`,
      [today.id,symbol,today.candle_date,analysis.candle_type,analysis.structure_label,analysis.body_pct,analysis.upper_wick_pct,analysis.lower_wick_pct,analysis.close_position,analysis.range_points,analysis.body_points,analysis.d1_bias,analysis.bias_confidence]);
  }
  if (rest[0]?.aid && !rest[0]?.next_day_direction) {
    const oc = classifyOutcome(rest[0].d1_bias, rest[0], today);
    await query(`UPDATE candle_analysis SET next_day_direction=$1,next_day_return_pct=$2,outcome_type=$3 WHERE id=$4`,[oc.next_day_direction,oc.next_day_return_pct,oc.outcome_type,rest[0].aid]);
  }
}
