'use strict';

// ── Guard: DATABASE_URL must exist ──────────────────────────────
if (!process.env.DATABASE_URL) {
  // Return a helpful error for every request instead of crashing
  exports.handler = async () => ({
    statusCode: 503,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      error: 'DATABASE_URL not set',
      fix: 'Netlify → Site configuration → Environment variables → Add DATABASE_URL (get it from neon.tech)'
    })
  });
  return;
}

const express      = require('express');
const serverless   = require('serverless-http');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const { query, initDb }          = require('../../db/db');
const { classifyCandle, classifyOutcome } = require('../../services/classifier');
const { generateReport, refreshPatternStats } = require('../../services/reporter');
const { subscribe, unsubscribe, sendReportNotifications, vapidPublicKey } = require('../../services/push');
const { getEAKey, regenerateEAKey } = require('../../services/settings');

const app = express();
app.use(express.json({ limit: '10mb' }));

let dbReady = false;
async function ensureDb() {
  if (!dbReady) { await initDb(); dbReady = true; }
}

// ── Middleware ──────────────────────────────────────────────────
function auth(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(403).json({ error: 'Invalid or expired token.' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}
async function eaAuth(req, res, next) {
  await ensureDb();
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key header.' });
  const valid = await getEAKey();
  if (key !== valid) return res.status(401).json({ error: 'Invalid EA key.' });
  next();
}

const SYM = ['UK100','DE30','GER30','XAUUSD','USOIL'];
const ALIAS = { GER30:'DE30',GER40:'DE30',DE40:'DE30',DAX:'DE30',DAX40:'DE30',FTSE:'UK100',FTSE100:'UK100',GOLD:'XAUUSD',WTI:'USOIL',OIL:'USOIL',CRUDE:'USOIL','USOIL+':'USOIL' };
const normSym = s => { const u=(s||'').toUpperCase().replace(/[^A-Z0-9+]/g,''); return ALIAS[u]||(SYM.includes(u)?u:null); };

// ════════ AUTH ════════════════════════════════════════════════
// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
  try {
    await ensureDb();
    const { username, email, password, display_name } = req.body;
    if (!username?.trim() || username.trim().length < 2)
      return res.status(400).json({ error: 'Username must be at least 2 characters.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'A valid email address is required.' });
    if (!password || password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const cnt = await query('SELECT COUNT(*) AS c FROM users');
    const isFirst = parseInt(cnt.rows[0].c) === 0;
    const hash = await bcrypt.hash(password, 12);

    const r = await query(
      `INSERT INTO users (username,email,password_hash,display_name,role)
       VALUES ($1,$2,$3,$4,$5) RETURNING id,username,email,display_name,role`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), hash, display_name?.trim()||username, isFirst?'admin':'user']
    );
    const user = r.rows[0];
    const token = jwt.sign({ id:user.id, username:user.username, role:user.role }, process.env.JWT_SECRET, { expiresIn:'30d' });
    res.json({ token, user });
  } catch(e) {
    if (e.code === '23505') return res.status(400).json({ error: 'That username or email is already registered.' });
    console.error(e); res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    await ensureDb();
    const id = (req.body.login||req.body.email||req.body.username||'').trim().toLowerCase();
    const { password } = req.body;
    if (!id || !password) return res.status(400).json({ error: 'Email/username and password required.' });

    const r = await query(
      `SELECT * FROM users WHERE (LOWER(email)=$1 OR LOWER(username)=$1) AND (status IS NULL OR status='active') LIMIT 1`,
      [id]
    );
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials.' });
    const user = r.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials.' });

    await query(`UPDATE users SET last_login=NOW() WHERE id=$1`, [user.id]);
    const token = jwt.sign({ id:user.id, username:user.username, role:user.role }, process.env.JWT_SECRET, { expiresIn:'30d' });
    res.json({ token, user:{ id:user.id,username:user.username,email:user.email,display_name:user.display_name,role:user.role } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    await ensureDb();
    const r = await query(`SELECT id,username,email,display_name,role,last_login FROM users WHERE id=$1`,[req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    await ensureDb();
    const { current_password, new_password } = req.body;
    if (!current_password||!new_password) return res.status(400).json({ error: 'Both passwords required.' });
    if (new_password.length < 8) return res.status(400).json({ error: 'New password min 8 characters.' });
    const r = await query(`SELECT password_hash FROM users WHERE id=$1`,[req.user.id]);
    if (!await bcrypt.compare(current_password, r.rows[0].password_hash)) return res.status(401).json({ error: 'Current password incorrect.' });
    await query(`UPDATE users SET password_hash=$1 WHERE id=$2`,[await bcrypt.hash(new_password,12),req.user.id]);
    res.json({ message: 'Password changed.' });
  } catch(e) { res.status(500).json({ error: 'Server error.' }); }
});

// PATCH /api/auth/profile
app.patch('/api/auth/profile', auth, async (req, res) => {
  try {
    await ensureDb();
    const { username, display_name, email } = req.body;
    const sets=[],params=[];let i=1;
    if (display_name!==undefined){sets.push(`display_name=$${i++}`);params.push(display_name.trim());}
    if (username!==undefined){if(username.trim().length<2)return res.status(400).json({error:'Username too short.'});sets.push(`username=$${i++}`);params.push(username.toLowerCase().trim());}
    if (email!==undefined){sets.push(`email=$${i++}`);params.push(email?email.toLowerCase().trim():null);}
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(req.user.id);
    const r = await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,username,email,display_name,role`,params);
    res.json(r.rows[0]);
  } catch(e) {
    if (e.code==='23505') return res.status(400).json({ error: 'Username or email already taken.' });
    res.status(500).json({ error: 'Server error.' });
  }
});

// ════════ ADMIN ═══════════════════════════════════════════════
app.get('/api/admin/users', auth, adminOnly, async (req,res) => {
  try { await ensureDb(); const r=await query(`SELECT id,username,email,display_name,role,status,last_login,created_at FROM users ORDER BY id`); res.json(r.rows); }
  catch(e){res.status(500).json({error:e.message});}
});

app.patch('/api/admin/users/:id', auth, adminOnly, async (req,res) => {
  try {
    await ensureDb();
    const {display_name,password,role,email,status}=req.body;
    const sets=[],params=[];let i=1;
    if(display_name!==undefined){sets.push(`display_name=$${i++}`);params.push(display_name);}
    if(role!==undefined){sets.push(`role=$${i++}`);params.push(role==='admin'?'admin':'user');}
    if(email!==undefined){sets.push(`email=$${i++}`);params.push(email?.toLowerCase().trim()||null);}
    if(status!==undefined){sets.push(`status=$${i++}`);params.push(status==='suspended'?'suspended':'active');}
    if(password){if(password.length<8)return res.status(400).json({error:'Password min 8 chars.'});sets.push(`password_hash=$${i++}`);params.push(await bcrypt.hash(password,12));}
    if(!sets.length)return res.status(400).json({error:'Nothing to update.'});
    params.push(req.params.id);
    const r=await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,username,email,display_name,role,status`,params);
    if(!r.rows.length)return res.status(404).json({error:'User not found.'});
    res.json({message:'Updated.',user:r.rows[0]});
  } catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/admin/users/:id', auth, adminOnly, async (req,res) => {
  try {
    await ensureDb();
    if(parseInt(req.params.id)===req.user.id) return res.status(400).json({error:'Cannot delete yourself.'});
    const r=await query(`DELETE FROM users WHERE id=$1 RETURNING username`,[req.params.id]);
    if(!r.rows.length)return res.status(404).json({error:'Not found.'});
    res.json({message:`Removed @${r.rows[0].username}`});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/admin/ea-key', auth, adminOnly, async (req,res) => {
  try { await ensureDb(); res.json({ea_key:await getEAKey()}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/admin/ea-key/regenerate', auth, adminOnly, async (req,res) => {
  try { await ensureDb(); res.json({ea_key:await regenerateEAKey()}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/admin/run-jobs', auth, adminOnly, async (req,res) => {
  try { await ensureDb(); res.json({message:'Jobs started.'}); setImmediate(()=>runNightlyJobs().catch(console.error)); }
  catch(e){res.status(500).json({error:e.message});}
});

// ════════ EA ══════════════════════════════════════════════════
app.post('/api/ea/push', eaAuth, async (req,res) => {
  try {
    const candles = Array.isArray(req.body)?req.body:[req.body];
    if(!candles.length)return res.status(400).json({error:'Empty.'});
    if(candles.length>5000)return res.status(400).json({error:'Max 5000.'});
    let ins=0,upd=0,skip=0;
    for(const c of candles){
      const sym=normSym(c.symbol);
      if(!sym||!c.date||isNaN(+c.open)||isNaN(+c.high)||isNaN(+c.low)||isNaN(+c.close)){skip++;continue;}
      const r=await query(`INSERT INTO candles (symbol,candle_date,open,high,low,close,volume) VALUES ($1,$2::date,$3,$4,$5,$6,$7) ON CONFLICT (symbol,candle_date) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,updated_at=NOW() RETURNING (xmax=0) AS ins`,[sym,c.date,+c.open,+c.high,+c.low,+c.close,+(c.volume||0)]).catch(()=>null);
      if(r?.rows[0]?.ins)ins++;else if(r)upd++;else skip++;
    }
    res.json({inserted:ins,updated:upd,skipped:skip});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/ea/status', eaAuth, async (req,res) => {
  try { const r=await query(`SELECT symbol,COUNT(*) total,MAX(candle_date) latest FROM candles GROUP BY symbol ORDER BY symbol`); res.json({status:'connected',symbols:r.rows}); }
  catch(e){res.status(500).json({error:e.message});}
});

// ════════ CANDLES ═════════════════════════════════════════════
app.get('/api/candles/', auth, async (req,res) => {
  try {
    await ensureDb();
    const r=await query(`SELECT c.symbol,COUNT(*) total_candles,MIN(c.candle_date) from_date,MAX(c.candle_date) to_date,c2.close latest_close,ca.d1_bias latest_bias FROM candles c LEFT JOIN candles c2 ON c2.symbol=c.symbol AND c2.candle_date=(SELECT MAX(candle_date) FROM candles WHERE symbol=c.symbol) LEFT JOIN candle_analysis ca ON ca.candle_id=c2.id GROUP BY c.symbol,c2.close,ca.d1_bias ORDER BY c.symbol`);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/candles/:symbol', auth, async (req,res) => {
  try {
    await ensureDb();
    const sym=req.params.symbol.toUpperCase();
    const limit=Math.min(parseInt(req.query.limit)||500,5000);
    const {from,to}=req.query;
    let q=`SELECT candle_date,open,high,low,close,volume FROM candles WHERE symbol=$1`,p=[sym],i=2;
    if(from){q+=` AND candle_date>=$${i++}::date`;p.push(from);}
    if(to){q+=` AND candle_date<=$${i++}::date`;p.push(to);}
    q+=` ORDER BY candle_date DESC LIMIT $${i}`;p.push(limit);
    const r=await query(q,p);
    res.json({symbol:sym,count:r.rows.length,candles:r.rows.reverse().map(c=>({date:c.candle_date,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume}))});
  }catch(e){res.status(500).json({error:e.message});}
});

// ════════ REPORTS ═════════════════════════════════════════════
app.get('/api/reports/latest', auth, async (req,res) => {
  try {
    await ensureDb();
    const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.report_date=(SELECT MAX(report_date) FROM daily_reports) ORDER BY r.symbol`);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/reports/:symbol', auth, async (req,res) => {
  try {
    await ensureDb();
    const sym=req.params.symbol.toUpperCase();
    const limit=Math.min(parseInt(req.query.limit)||60,365);
    const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 ORDER BY r.report_date DESC LIMIT $2`,[sym,limit]);
    res.json(r.rows);
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/reports/:symbol/:date', auth, async (req,res) => {
  try {
    await ensureDb();
    const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 AND r.report_date=$2::date`,[req.params.symbol.toUpperCase(),req.params.date]);
    if(!r.rows.length)return res.status(404).json({error:'Report not found.'});
    res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message});}
});

// ════════ PUSH ════════════════════════════════════════════════
app.get('/api/push/key', (req,res) => res.json({key:vapidPublicKey()}));
app.post('/api/push/subscribe', auth, async (req,res) => {
  try { await ensureDb(); await subscribe(req.user.id,req.body.subscription,req.body.label); res.json({ok:true}); }
  catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/push/unsubscribe', auth, async (req,res) => {
  try { await unsubscribe(req.body.endpoint); res.json({ok:true}); }
  catch(e){res.status(500).json({error:e.message});}
});

// ════════ CRON ════════════════════════════════════════════════
app.post('/api/cron/nightly', async (req,res) => {
  const secret = req.headers['x-cron-secret']||req.body?.secret;
  if (!secret || secret !== process.env.CRON_SECRET) return res.status(401).json({error:'Unauthorized.'});
  res.json({message:'Jobs started.'});
  setImmediate(() => runNightlyJobs().catch(console.error));
});

// ════════ NIGHTLY JOBS ════════════════════════════════════════
const SYMBOLS = ['UK100','DE30','XAUUSD','USOIL'];

async function runNightlyJobs() {
  console.log('▶ Nightly jobs starting');
  await ensureDb();
  for (const sym of SYMBOLS) {
    try { await classifyLatest(sym); } catch(e) { console.error(`Classify ${sym}:`,e.message); }
  }
  for (const sym of SYMBOLS) {
    try { await refreshPatternStats(sym); } catch(e) { console.error(`Stats ${sym}:`,e.message); }
  }
  const reports = [];
  for (const sym of SYMBOLS) {
    try {
      const r=await query(`SELECT c.*,ca.candle_type,ca.structure_label,ca.d1_bias,ca.bias_confidence FROM candles c JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 1`,[sym]);
      if(!r.rows.length) continue;
      const row=r.rows[0];
      const rep=await generateReport(sym,row,{candle_type:row.candle_type,structure_label:row.structure_label,d1_bias:row.d1_bias,bias_confidence:row.bias_confidence});
      await query(`INSERT INTO daily_reports (symbol,report_date,candle_id,candle_type,bias,bias_confidence,key_levels,report_text,short_summary,generated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (symbol,report_date) DO UPDATE SET candle_type=$4,bias=$5,bias_confidence=$6,key_levels=$7,report_text=$8,short_summary=$9,generated_at=NOW()`,
        [sym,row.candle_date,row.id,rep.candle_type,rep.bias,rep.bias_confidence,JSON.stringify(rep.key_levels),rep.report_text,rep.short_summary]);
      reports.push(rep);
    } catch(e) { console.error(`Report ${sym}:`,e.message); }
  }
  await sendReportNotifications(reports).catch(console.error);
  console.log(`✓ Nightly done — ${reports.length} reports`);
}

async function classifyLatest(symbol) {
  const res=await query(`SELECT c.*,ca.candle_type,ca.d1_bias,ca.structure_label,ca.id AS aid FROM candles c LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 22`,[symbol]);
  if(!res.rows.length) return;
  const [today,...rest]=res.rows;
  if(!today.aid) {
    const analysis=classifyCandle(today,rest[0]||null,rest.slice(0,20).reverse());
    await query(`INSERT INTO candle_analysis (candle_id,symbol,candle_date,candle_type,structure_label,body_pct,upper_wick_pct,lower_wick_pct,close_position,range_points,body_points,d1_bias,bias_confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (candle_id) DO NOTHING`,
      [today.id,symbol,today.candle_date,analysis.candle_type,analysis.structure_label,analysis.body_pct,analysis.upper_wick_pct,analysis.lower_wick_pct,analysis.close_position,analysis.range_points,analysis.body_points,analysis.d1_bias,analysis.bias_confidence]);
  }
  if(rest[0]?.aid&&!rest[0]?.next_day_direction) {
    const oc=classifyOutcome(rest[0].d1_bias,rest[0],today);
    await query(`UPDATE candle_analysis SET next_day_direction=$1,next_day_return_pct=$2,outcome_type=$3 WHERE id=$4`,[oc.next_day_direction,oc.next_day_return_pct,oc.outcome_type,rest[0].aid]);
  }
}

app.get('/api/health', (_,res) => res.json({ok:true,time:new Date().toISOString()}));

exports.handler = serverless(app);
