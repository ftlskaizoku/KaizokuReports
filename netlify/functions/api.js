'use strict';

const express        = require('express');
const serverless     = require('serverless-http');
const bcrypt         = require('bcryptjs');
const jwt            = require('jsonwebtoken');
const { query, initDb } = require('../../db/db');
const { classifyCandle, classifyContextualPattern, classifyOutcome } = require('../../services/candleClassifier');
const { generateReport, refreshPatternStats } = require('../../services/reportGenerator');
const { sendDailyReportNotifications, saveSubscription, removeSubscription, ensureVapid } = require('../../services/pushNotifications');
const { getEAKey, regenerateEAKey, isSetupRequired } = require('../../services/settingsService');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── DB init once per cold start ──
let dbReady = false;
async function ensureDb() {
  if (!dbReady) { await initDb(); dbReady = true; }
}

// ── Auth helpers ──
function authMiddleware(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token.' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(403).json({ error: 'Invalid token.' }); }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  next();
}
async function eaAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key.' });
  const valid = await getEAKey();
  if (key !== valid) return res.status(401).json({ error: 'Invalid EA key.' });
  next();
}

const VALID_SYMBOLS = ['UK100','DE30','GER30','XAUUSD','USOIL'];
const ALIASES = { GER30:'DE30',GER40:'DE30',DE40:'DE30',DAX:'DE30',DAX40:'DE30',FTSE:'UK100',FTSE100:'UK100',GOLD:'XAUUSD',WTI:'USOIL',OIL:'USOIL',CRUDE:'USOIL' };
function normSym(s) { const u=(s||'').toUpperCase().replace(/[^A-Z0-9]/g,''); return ALIASES[u]||(VALID_SYMBOLS.includes(u)?u:null); }

// ════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════
app.get('/api/setup/status', async (req, res) => {
  try { await ensureDb(); res.json({ setup_required: await isSetupRequired() }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/setup', async (req, res) => {
  try {
    await ensureDb();
    if (!(await isSetupRequired())) return res.status(400).json({ error: 'Setup already complete.' });
    const { users } = req.body;
    if (!users?.length) return res.status(400).json({ error: 'Provide users array.' });
    if (users.length > 4) return res.status(400).json({ error: 'Max 4 users.' });
    for (let i=0;i<users.length;i++) {
      if (!users[i].username||users[i].username.length<2) return res.status(400).json({ error:`User ${i+1}: username too short.` });
      if (!users[i].password||users[i].password.length<8) return res.status(400).json({ error:`User ${i+1}: password min 8 chars.` });
    }
    const created = [];
    for (let i=0;i<users.length;i++) {
      const u=users[i];
      const hash=await bcrypt.hash(u.password,12);
      const r=await query(
        `INSERT INTO users (username,email,password_hash,display_name,role) VALUES ($1,$2,$3,$4,$5)
         RETURNING id,username,email,display_name,role`,
        [u.username.toLowerCase().trim(),u.email?.toLowerCase().trim()||null,hash,u.display_name||u.username,i===0?'admin':'user']
      );
      created.push(r.rows[0]);
    }
    const eaKey=await getEAKey();
    res.json({ message:'Setup complete.', users:created, ea_key:eaKey });
  } catch(e) {
    if(e.code==='23505') return res.status(400).json({ error:'Username or email already taken.' });
    res.status(500).json({ error:e.message });
  }
});

// ════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  try {
    await ensureDb();
    const identifier=(req.body.login||req.body.email||req.body.username||'').trim().toLowerCase();
    const { password } = req.body;
    if (!identifier||!password) return res.status(400).json({ error:'Credentials required.' });
    const r=await query(
      `SELECT * FROM users WHERE (LOWER(email)=$1 OR LOWER(username)=$1) AND (status IS NULL OR status='active') LIMIT 1`,
      [identifier]
    );
    if (!r.rows.length) return res.status(401).json({ error:'Invalid credentials.' });
    const user=r.rows[0];
    if (!await bcrypt.compare(password,user.password_hash)) return res.status(401).json({ error:'Invalid credentials.' });
    await query(`UPDATE users SET last_login=NOW() WHERE id=$1`,[user.id]);
    const token=jwt.sign({id:user.id,username:user.username,role:user.role},process.env.JWT_SECRET,{expiresIn:'30d'});
    res.json({ token, user:{id:user.id,username:user.username,email:user.email,display_name:user.display_name,role:user.role} });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    await ensureDb();
    const { email, username, display_name, password } = req.body;
    if (!email || !email.trim()) return res.status(400).json({ error:'Email is required.' });
    if (!username || username.trim().length < 2) return res.status(400).json({ error:'Username must be at least 2 characters.' });
    if (!password || password.length < 8) return res.status(400).json({ error:'Password must be at least 8 characters.' });
    const cnt = await query(`SELECT COUNT(*) AS c FROM users`);
    if (parseInt(cnt.rows[0].c, 10) >= 4) return res.status(400).json({ error:'Registration is closed. Max users reached.' });
    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      `INSERT INTO users (username,email,password_hash,display_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,email,display_name,role`,
      [username.toLowerCase().trim(), email.toLowerCase().trim(), hash, display_name || username, 'user']
    );
    const user = r.rows[0];
    const token = jwt.sign({ id:user.id, username:user.username, role:user.role }, process.env.JWT_SECRET, { expiresIn:'30d' });
    res.json({ token, user });
  } catch(e) {
    if (e.code === '23505') return res.status(400).json({ error:'Username or email already taken.' });
    res.status(500).json({ error:e.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req,res)=>{
  try {
    await ensureDb();
    const r=await query(`SELECT id,username,email,display_name,role,last_login FROM users WHERE id=$1`,[req.user.id]);
    if(!r.rows.length) return res.status(404).json({error:'Not found.'});
    res.json(r.rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/auth/change-password', authMiddleware, async (req,res)=>{
  try {
    await ensureDb();
    const {current_password,new_password}=req.body;
    if(!current_password||!new_password) return res.status(400).json({error:'Both passwords required.'});
    if(new_password.length<8) return res.status(400).json({error:'Min 8 characters.'});
    const r=await query(`SELECT password_hash FROM users WHERE id=$1`,[req.user.id]);
    if(!await bcrypt.compare(current_password,r.rows[0].password_hash)) return res.status(401).json({error:'Current password incorrect.'});
    await query(`UPDATE users SET password_hash=$1 WHERE id=$2`,[await bcrypt.hash(new_password,12),req.user.id]);
    res.json({message:'Password changed.'});
  } catch(e){res.status(500).json({error:e.message});}
});

app.patch('/api/auth/profile', authMiddleware, async (req,res)=>{
  try {
    await ensureDb();
    const {username,display_name,email}=req.body;
    const updates=[],params=[];let idx=1;
    if(display_name!==undefined){updates.push(`display_name=$${idx++}`);params.push(display_name.trim());}
    if(username!==undefined){if(username.trim().length<2)return res.status(400).json({error:'Username too short.'});updates.push(`username=$${idx++}`);params.push(username.toLowerCase().trim());}
    if(email!==undefined){updates.push(`email=$${idx++}`);params.push(email?email.toLowerCase().trim():null);}
    if(!updates.length) return res.status(400).json({error:'Nothing to update.'});
    params.push(req.user.id);
    const r=await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${idx} RETURNING id,username,email,display_name,role`,params);
    res.json(r.rows[0]);
  } catch(e){
    if(e.code==='23505') return res.status(400).json({error:'Username or email taken.'});
    res.status(500).json({error:e.message});
  }
});

// ════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════
app.get('/api/admin/users', authMiddleware, adminOnly, async (req,res)=>{
  try { await ensureDb(); const r=await query(`SELECT id,username,email,display_name,role,status,last_login,created_at FROM users ORDER BY id`); res.json(r.rows); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/admin/users', authMiddleware, adminOnly, async (req,res)=>{
  try {
    await ensureDb();
    const cnt=await query(`SELECT COUNT(*) AS c FROM users`);
    if(parseInt(cnt.rows[0].c)>=4) return res.status(400).json({error:'Max 4 users.'});
    const {username,email,password,display_name,role}=req.body;
    if(!username||username.trim().length<2) return res.status(400).json({error:'Username min 2 chars.'});
    if(!password||password.length<8) return res.status(400).json({error:'Password min 8 chars.'});
    const hash=await bcrypt.hash(password,12);
    const r=await query(
      `INSERT INTO users (username,email,password_hash,display_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,email,display_name,role`,
      [username.toLowerCase().trim(),email?.toLowerCase().trim()||null,hash,display_name||username,role==='admin'?'admin':'user']
    );
    res.json({message:'User created.',user:r.rows[0]});
  } catch(e){
    if(e.code==='23505') return res.status(400).json({error:'Username or email exists.'});
    res.status(500).json({error:e.message});
  }
});

app.patch('/api/admin/users/:id', authMiddleware, adminOnly, async (req,res)=>{
  try {
    await ensureDb();
    const {display_name,password,role,email,status}=req.body;
    const updates=[],params=[];let idx=1;
    if(display_name!==undefined){updates.push(`display_name=$${idx++}`);params.push(display_name);}
    if(role!==undefined){updates.push(`role=$${idx++}`);params.push(role==='admin'?'admin':'user');}
    if(email!==undefined){updates.push(`email=$${idx++}`);params.push(email?.toLowerCase().trim()||null);}
    if(status!==undefined){updates.push(`status=$${idx++}`);params.push(status==='suspended'?'suspended':'active');}
    if(password){if(password.length<8)return res.status(400).json({error:'Password min 8 chars.'});updates.push(`password_hash=$${idx++}`);params.push(await bcrypt.hash(password,12));}
    if(!updates.length) return res.status(400).json({error:'Nothing to update.'});
    params.push(req.params.id);
    const r=await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${idx} RETURNING id,username,email,display_name,role,status`,params);
    if(!r.rows.length) return res.status(404).json({error:'User not found.'});
    res.json({message:'Updated.',user:r.rows[0]});
  } catch(e){res.status(500).json({error:e.message});}
});

app.delete('/api/admin/users/:id', authMiddleware, adminOnly, async (req,res)=>{
  try {
    await ensureDb();
    if(parseInt(req.params.id)===req.user.id) return res.status(400).json({error:'Cannot delete yourself.'});
    const r=await query(`DELETE FROM users WHERE id=$1 RETURNING username`,[req.params.id]);
    if(!r.rows.length) return res.status(404).json({error:'Not found.'});
    res.json({message:`User "${r.rows[0].username}" removed.`});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/admin/ea-key', authMiddleware, adminOnly, async (req,res)=>{
  try { await ensureDb(); res.json({ea_key:await getEAKey()}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/admin/ea-key/regenerate', authMiddleware, adminOnly, async (req,res)=>{
  try { await ensureDb(); res.json({message:'Key regenerated. Update in EA settings.',ea_key:await regenerateEAKey()}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/admin/run-jobs', authMiddleware, adminOnly, async (req,res)=>{
  try {
    await ensureDb();
    res.json({message:'Jobs running. Reports will update shortly.'});
    setImmediate(()=>runNightlyJobs().catch(console.error));
  } catch(e){res.status(500).json({error:e.message});}
});

// ════════════════════════════════════════════
// EA DATA PUSH
// ════════════════════════════════════════════
app.post('/api/ea/push', eaAuth, async (req,res)=>{
  try {
    await ensureDb();
    const candles=Array.isArray(req.body)?req.body:[req.body];
    if(!candles.length) return res.status(400).json({error:'No candles.'});
    if(candles.length>5000) return res.status(400).json({error:'Max 5000 per request.'});
    let inserted=0,updated=0,skipped=0;
    for(const c of candles){
      const sym=normSym(c.symbol);
      if(!sym||!c.date||isNaN(+c.open)||isNaN(+c.high)||isNaN(+c.low)||isNaN(+c.close)){skipped++;continue;}
      const r=await query(
        `INSERT INTO candles (symbol,candle_date,open,high,low,close,volume) VALUES ($1,$2::date,$3,$4,$5,$6,$7)
         ON CONFLICT (symbol,candle_date) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,updated_at=NOW()
         RETURNING (xmax=0) AS ins`,
        [sym,c.date,+c.open,+c.high,+c.low,+c.close,+(c.volume||0)]
      ).catch(()=>null);
      if(r?.rows[0]?.ins) inserted++; else if(r) updated++; else skipped++;
    }
    res.json({inserted,updated,skipped});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/ea/status', eaAuth, async (req,res)=>{
  try {
    await ensureDb();
    const r=await query(`SELECT symbol,COUNT(*) total,MAX(candle_date) latest FROM candles GROUP BY symbol ORDER BY symbol`);
    res.json({status:'connected',symbols:r.rows,time:new Date().toISOString()});
  } catch(e){res.status(500).json({error:e.message});}
});

// ════════════════════════════════════════════
// CANDLES (charts)
// ════════════════════════════════════════════
app.get('/api/candles/', async (req,res)=>{
  try {
    await ensureDb();
    const r=await query(`SELECT c.symbol,COUNT(*) total_candles,MIN(c.candle_date) from_date,MAX(c.candle_date) to_date,c2.close latest_close,ca.candle_type latest_type,ca.d1_bias latest_bias FROM candles c LEFT JOIN candles c2 ON c2.symbol=c.symbol AND c2.candle_date=(SELECT MAX(candle_date) FROM candles WHERE symbol=c.symbol) LEFT JOIN candle_analysis ca ON ca.candle_id=c2.id GROUP BY c.symbol,c2.close,ca.candle_type,ca.d1_bias ORDER BY c.symbol`);
    res.json(r.rows);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/candles/:symbol', async (req,res)=>{
  try {
    await ensureDb();
    const sym=req.params.symbol.toUpperCase();
    const limit=Math.min(parseInt(req.query.limit)||500,5000);
    const {from,to}=req.query;
    let q=`SELECT candle_date,open,high,low,close,volume FROM candles WHERE symbol=$1`,params=[sym],idx=2;
    if(from){q+=` AND candle_date>=$${idx++}::date`;params.push(from);}
    if(to){q+=` AND candle_date<=$${idx++}::date`;params.push(to);}
    q+=` ORDER BY candle_date DESC LIMIT $${idx}`;params.push(limit);
    const r=await query(q,params);
    res.json({symbol:sym,count:r.rows.length,candles:r.rows.reverse().map(c=>({date:c.candle_date,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume}))});
  } catch(e){res.status(500).json({error:e.message});}
});

// ════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════
app.get('/api/reports/latest', async (req,res)=>{
  try {
    await ensureDb();
    const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.report_date=(SELECT MAX(report_date) FROM daily_reports) ORDER BY r.symbol`);
    res.json(r.rows);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/reports/:symbol', async (req,res)=>{
  try {
    await ensureDb();
    if(req.params.symbol==='run') return res.status(404).json({error:'Use POST.'});
    const sym=req.params.symbol.toUpperCase();
    const limit=Math.min(parseInt(req.query.limit)||60,365);
    const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 ORDER BY r.report_date DESC LIMIT $2`,[sym,limit]);
    res.json(r.rows);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/reports/:symbol/:date', async (req,res)=>{
  try {
    await ensureDb();
    const sym=req.params.symbol.toUpperCase();
    const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label,ca.body_pct,ca.upper_wick_pct,ca.lower_wick_pct FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 AND r.report_date=$2::date`,[sym,req.params.date]);
    if(!r.rows.length) return res.status(404).json({error:'Report not found.'});
    res.json(r.rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

// ════════════════════════════════════════════
// PUSH
// ════════════════════════════════════════════
app.get('/api/push/vapid-public-key', (req,res)=>{
  res.json({key:process.env.VAPID_PUBLIC_KEY||null});
});

app.post('/api/push/subscribe', authMiddleware, async (req,res)=>{
  try {
    await ensureDb();
    const {subscription,device_label}=req.body;
    if(!subscription?.endpoint) return res.status(400).json({error:'Invalid subscription.'});
    await saveSubscription(req.user.id,subscription,device_label);
    res.json({message:'Subscribed.'});
  } catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/push/unsubscribe', authMiddleware, async (req,res)=>{
  try { await ensureDb(); await removeSubscription(req.body.endpoint); res.json({message:'Unsubscribed.'}); }
  catch(e){res.status(500).json({error:e.message});}
});

// ════════════════════════════════════════════
// NIGHTLY JOBS (called by cron-job.org or admin)
// ════════════════════════════════════════════
const SYMBOLS=['UK100','DE30','XAUUSD','USOIL'];

async function runNightlyJobs() {
  console.log('Running nightly jobs...');
  await ensureDb();
  for(const sym of SYMBOLS) {
    try { await classifyLatestCandle(sym); } catch(e){ console.error(`Classify error ${sym}:`,e.message); }
  }
  for(const sym of SYMBOLS) {
    try { await refreshPatternStats(sym); } catch(e){ console.error(`Stats error ${sym}:`,e.message); }
  }
  const reports=[];
  for(const sym of SYMBOLS) {
    try {
      const r=await query(`SELECT c.*,ca.candle_type,ca.structure_label,ca.d1_bias,ca.bias_confidence FROM candles c JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 1`,[sym]);
      if(!r.rows.length) continue;
      const row=r.rows[0];
      const report=await generateReport(sym,{id:row.id,open:row.open,high:row.high,low:row.low,close:row.close,candle_date:row.candle_date},{candle_type:row.candle_type,structure_label:row.structure_label,d1_bias:row.d1_bias,bias_confidence:row.bias_confidence});
      await query(`INSERT INTO daily_reports (symbol,report_date,candle_id,candle_type,bias,bias_confidence,key_levels,report_text,short_summary,generated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (symbol,report_date) DO UPDATE SET candle_type=$4,bias=$5,bias_confidence=$6,key_levels=$7,report_text=$8,short_summary=$9,generated_at=NOW()`,
        [sym,row.candle_date,row.id,report.candle_type,report.bias,report.bias_confidence,JSON.stringify(report.key_levels),report.report_text,report.short_summary]);
      reports.push(report);
    } catch(e){ console.error(`Report error ${sym}:`,e.message); }
  }
  await sendDailyReportNotifications(reports).catch(console.error);
  console.log(`Jobs done. ${reports.length} reports generated.`);
}

// Cron endpoint — called by cron-job.org at 22:30 UTC Mon-Fri
// Protected by a shared secret set as CRON_SECRET env variable
app.post('/api/cron/nightly', async (req,res)=>{
  const secret=req.headers['x-cron-secret']||req.body?.secret;
  if(!secret||secret!==process.env.CRON_SECRET) return res.status(401).json({error:'Unauthorized.'});
  res.json({message:'Jobs started.'});
  setImmediate(()=>runNightlyJobs().catch(console.error));
});

async function classifyLatestCandle(symbol) {
  const res=await query(`SELECT c.*,ca.candle_type,ca.d1_bias,ca.structure_label,ca.id as aid FROM candles c LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 22`,[symbol]);
  if(!res.rows.length) return;
  const [today,...rest]=res.rows;
  const prev=rest[0]||null;
  const history=rest.slice(0,20).reverse();
  if(!today.aid) {
    let analysis=classifyCandle(today,prev,history);
    if(prev) { const ctx=classifyContextualPattern(today,prev); if(ctx) analysis.candle_type=ctx; }
    await query(`INSERT INTO candle_analysis (candle_id,symbol,candle_date,candle_type,structure_label,body_pct,upper_wick_pct,lower_wick_pct,close_position,range_points,body_points,d1_bias,bias_confidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (candle_id) DO NOTHING`,
      [today.id,symbol,today.candle_date,analysis.candle_type,analysis.structure_label,analysis.body_pct,analysis.upper_wick_pct,analysis.lower_wick_pct,analysis.close_position,analysis.range_points,analysis.body_points,analysis.d1_bias,analysis.bias_confidence]);
  }
  if(prev?.aid&&!prev.next_day_direction) {
    const oc=classifyOutcome({d1_bias:prev.d1_bias},prev,today);
    await query(`UPDATE candle_analysis SET next_day_direction=$1,next_day_return_pct=$2,outcome_type=$3 WHERE id=$4`,[oc.next_day_direction,oc.next_day_return_pct,oc.outcome_type,prev.aid]);
  }
}

// Health check
app.get('/api/health', (req,res)=>res.json({status:'ok',time:new Date().toISOString()}));

module.exports.handler = serverless(app);
