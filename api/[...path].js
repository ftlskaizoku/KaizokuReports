'use strict';
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query, initDb }           = require('../lib/db');
const { classifyCandle, classifyOutcome } = require('../lib/classifier');
const { generateReport, refreshPatternStats } = require('../lib/reporter');
const { subscribe, unsubscribe, sendReportNotifications, vapidPublicKey } = require('../lib/push');
const { getEAKey, regenerateEAKey } = require('../lib/settings');

let dbReady = false;
async function ensureDb() { if (!dbReady) { await initDb(); dbReady = true; } }

const SYMBOLS = ['UK100','DE30','XAUUSD','USOIL'];
const SYM_VALID = ['UK100','DE30','GER30','XAUUSD','USOIL'];
const ALIAS = { GER30:'DE30',GER40:'DE30',DE40:'DE30',DAX:'DE30',DAX40:'DE30',FTSE:'UK100',FTSE100:'UK100',GOLD:'XAUUSD',WTI:'USOIL',OIL:'USOIL',CRUDE:'USOIL','USOIL+':'USOIL' };
const normSym = s => { const u=(s||'').toUpperCase().replace(/[^A-Z0-9+]/g,''); return ALIAS[u]||(SYM_VALID.includes(u)?u:null); };

function ok(res, data, status=200) { res.status(status).json(data); }
function err(res, msg, status=400) { res.status(status).json({ error: msg }); }
function tok(req) { return (req.headers.authorization||'').split(' ')[1]||null; }
function auth(t) {
  if (!t) throw { s:401, m:'Not authenticated.' };
  try { return jwt.verify(t, process.env.JWT_SECRET); }
  catch { throw { s:403, m:'Invalid or expired token.' }; }
}
async function eaAuth(req) {
  const k = req.headers['x-api-key'];
  if (!k) throw { s:401, m:'Missing X-Api-Key.' };
  if (k !== await getEAKey()) throw { s:401, m:'Invalid EA key.' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,X-Api-Key,X-Cron-Secret');
  if (req.method==='OPTIONS') return res.status(200).end();

  // Vercel: manually parse body if not already parsed
  if (req.body === undefined && req.method !== 'GET') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      req.body = raw ? JSON.parse(raw) : {};
    } catch { req.body = {}; }
  }

  if (!process.env.DATABASE_URL)
    return ok(res, { error:'DATABASE_URL not set', fix:'Vercel → Project Settings → Environment Variables → Add DATABASE_URL from neon.tech' }, 503);
  if (!process.env.JWT_SECRET)
    return ok(res, { error:'JWT_SECRET not set', fix:'Vercel → Project Settings → Environment Variables → Add JWT_SECRET' }, 503);

  // Parse URL — strip /api prefix, remove trailing slash, handle query string
  const rawUrl  = req.url || '/';
  // Vercel [...path].js: req.url may or may not include /api prefix — strip it either way
  const urlPath = rawUrl.split('?')[0]
    .replace(/^\/api/, '')   // strip /api prefix if present
    .replace(/\/+$/, '')     // strip trailing slashes
    || '/';
  const method  = req.method;
  const body    = req.body || {};
  const qs      = new URLSearchParams(rawUrl.includes('?') ? rawUrl.split('?')[1] : '');
  
  // Debug: log every request so we can see what's being called
  console.log(`[${method}] ${urlPath} (raw: ${rawUrl})`);

  try {
    await ensureDb();

    // ── HEALTH ──
    if (urlPath === '/health') return ok(res, { ok:true, time:new Date().toISOString() });

    // ── AUTH ──
    if (method==='POST' && urlPath==='/auth/signup') {
      const { username, email, password, display_name } = body;
      if (!username?.trim() || username.trim().length < 2) return err(res,'Username must be at least 2 characters.');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err(res,'A valid email is required.');
      if (!password || password.length < 8) return err(res,'Password must be at least 8 characters.');
      const cnt = await query('SELECT COUNT(*) AS c FROM users');
      const isFirst = parseInt(cnt.rows[0].c)===0;
      const hash = await bcrypt.hash(password,12);
      try {
        const r = await query(`INSERT INTO users(username,email,password_hash,display_name,role) VALUES($1,$2,$3,$4,$5) RETURNING id,username,email,display_name,role`,
          [username.toLowerCase().trim(),email.toLowerCase().trim(),hash,display_name?.trim()||username,isFirst?'admin':'user']);
        const u=r.rows[0];
        const token=jwt.sign({id:u.id,username:u.username,role:u.role},process.env.JWT_SECRET,{expiresIn:'30d'});
        return ok(res,{token,user:u});
      } catch(e) { if(e.code==='23505')return err(res,'That username or email is already registered.'); throw e; }
    }

    if (method==='POST' && urlPath==='/auth/login') {
      const id=(body.login||body.email||body.username||'').trim().toLowerCase();
      if(!id||!body.password)return err(res,'Email/username and password required.');
      const r=await query(`SELECT * FROM users WHERE(LOWER(email)=$1 OR LOWER(username)=$1)AND(status IS NULL OR status='active')LIMIT 1`,[id]);
      if(!r.rows.length)return err(res,'Invalid credentials.',401);
      const u=r.rows[0];
      if(!await bcrypt.compare(body.password,u.password_hash))return err(res,'Invalid credentials.',401);
      await query(`UPDATE users SET last_login=NOW() WHERE id=$1`,[u.id]);
      const token=jwt.sign({id:u.id,username:u.username,role:u.role},process.env.JWT_SECRET,{expiresIn:'30d'});
      return ok(res,{token,user:{id:u.id,username:u.username,email:u.email,display_name:u.display_name,role:u.role}});
    }

    if (method==='GET' && urlPath==='/auth/me') {
      const u=auth(tok(req));
      const r=await query(`SELECT id,username,email,display_name,role,last_login FROM users WHERE id=$1`,[u.id]);
      if(!r.rows.length)return err(res,'User not found.',404);
      return ok(res,r.rows[0]);
    }

    if (method==='POST' && urlPath==='/auth/change-password') {
      const u=auth(tok(req));
      const{current_password,new_password}=body;
      if(!current_password||!new_password)return err(res,'Both passwords required.');
      if(new_password.length<8)return err(res,'Min 8 characters.');
      const r=await query(`SELECT password_hash FROM users WHERE id=$1`,[u.id]);
      if(!await bcrypt.compare(current_password,r.rows[0].password_hash))return err(res,'Current password incorrect.',401);
      await query(`UPDATE users SET password_hash=$1 WHERE id=$2`,[await bcrypt.hash(new_password,12),u.id]);
      return ok(res,{message:'Password changed.'});
    }

    if (method==='PATCH' && urlPath==='/auth/profile') {
      const u=auth(tok(req));
      const{username,display_name,email}=body;
      const sets=[],params=[];let i=1;
      if(display_name!==undefined){sets.push(`display_name=$${i++}`);params.push(display_name.trim());}
      if(username!==undefined){if(username.trim().length<2)return err(res,'Username too short.');sets.push(`username=$${i++}`);params.push(username.toLowerCase().trim());}
      if(email!==undefined){sets.push(`email=$${i++}`);params.push(email?email.toLowerCase().trim():null);}
      if(!sets.length)return err(res,'Nothing to update.');
      params.push(u.id);
      try{const r=await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,username,email,display_name,role`,params);return ok(res,r.rows[0]);}
      catch(e){if(e.code==='23505')return err(res,'Username or email already taken.');throw e;}
    }

    // ── ADMIN ──
    if (method==='GET' && urlPath==='/admin/users') {
      const u=auth(tok(req));if(u.role!=='admin')return err(res,'Admin only.',403);
      const r=await query(`SELECT id,username,email,display_name,role,status,last_login,created_at FROM users ORDER BY id`);
      return ok(res,r.rows);
    }

    const auMatch=urlPath.match(/^\/admin\/users\/(\d+)$/);
    if (auMatch) {
      const u=auth(tok(req));if(u.role!=='admin')return err(res,'Admin only.',403);
      const uid=auMatch[1];
      if (method==='PATCH') {
        const{display_name,password,role,email,status}=body;
        const sets=[],params=[];let i=1;
        if(display_name!==undefined){sets.push(`display_name=$${i++}`);params.push(display_name);}
        if(role!==undefined){sets.push(`role=$${i++}`);params.push(role==='admin'?'admin':'user');}
        if(email!==undefined){sets.push(`email=$${i++}`);params.push(email?.toLowerCase().trim()||null);}
        if(status!==undefined){sets.push(`status=$${i++}`);params.push(status==='suspended'?'suspended':'active');}
        if(password){if(password.length<8)return err(res,'Min 8 chars.');sets.push(`password_hash=$${i++}`);params.push(await bcrypt.hash(password,12));}
        if(!sets.length)return err(res,'Nothing to update.');
        params.push(uid);
        const r=await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,username,email,display_name,role,status`,params);
        if(!r.rows.length)return err(res,'Not found.',404);
        return ok(res,{message:'Updated.',user:r.rows[0]});
      }
      if (method==='DELETE') {
        if(parseInt(uid)===u.id)return err(res,'Cannot delete yourself.');
        const r=await query(`DELETE FROM users WHERE id=$1 RETURNING username`,[uid]);
        if(!r.rows.length)return err(res,'Not found.',404);
        return ok(res,{message:'Removed @'+r.rows[0].username});
      }
    }

    if (method==='GET' && urlPath==='/admin/ea-key') {
      const u=auth(tok(req));if(u.role!=='admin')return err(res,'Admin only.',403);
      return ok(res,{ea_key:await getEAKey()});
    }

    if (method==='POST' && urlPath==='/admin/ea-key/regenerate') {
      const u=auth(tok(req));if(u.role!=='admin')return err(res,'Admin only.',403);
      return ok(res,{ea_key:await regenerateEAKey()});
    }

    if (method==='POST' && urlPath==='/admin/run-jobs') {
      const u=auth(tok(req));if(u.role!=='admin')return err(res,'Admin only.',403);
      ok(res,{message:'Jobs started.'});
      setImmediate(()=>runNightlyJobs().catch(console.error));
      return;
    }

    // Bulk backfill: classify ALL candles + generate ALL missing reports
    if (method==='POST' && urlPath==='/admin/backfill') {
      const u=auth(tok(req));if(u.role!=='admin')return err(res,'Admin only.',403);
      ok(res,{message:'Backfill started — this may take a minute.'});
      setImmediate(()=>runBackfill().catch(console.error));
      return;
    }

    // ── EA ──
    if (method==='POST' && urlPath==='/ea/push') {
      await eaAuth(req);
      const candles=Array.isArray(body)?body:[body];
      if(!candles.length)return err(res,'Empty.');
      let ins=0,upd=0,skip=0;
      for(const c of candles){
        const sym=normSym(c.symbol);
        if(!sym||!c.date||isNaN(+c.open)||isNaN(+c.high)||isNaN(+c.low)||isNaN(+c.close)){skip++;continue;}
        const r=await query(`INSERT INTO candles(symbol,candle_date,open,high,low,close,volume) VALUES($1,$2::date,$3,$4,$5,$6,$7) ON CONFLICT(symbol,candle_date) DO UPDATE SET open=EXCLUDED.open,high=EXCLUDED.high,low=EXCLUDED.low,close=EXCLUDED.close,volume=EXCLUDED.volume,updated_at=NOW() RETURNING(xmax=0)AS ins`,
          [sym,c.date,+c.open,+c.high,+c.low,+c.close,+(c.volume||0)]).catch(()=>null);
        if(r?.rows[0]?.ins)ins++;else if(r)upd++;else skip++;
      }
      return ok(res,{inserted:ins,updated:upd,skipped:skip});
    }

    if (method==='GET' && urlPath==='/ea/status') {
      await eaAuth(req);
      const r=await query(`SELECT symbol,COUNT(*)total,MAX(candle_date)latest FROM candles GROUP BY symbol ORDER BY symbol`);
      return ok(res,{status:'connected',symbols:r.rows});
    }

    // ── CANDLES ──
    if (method==='GET' && urlPath==='/candles/') {
      auth(tok(req));
      const r=await query(`SELECT c.symbol,COUNT(*)total_candles,MIN(c.candle_date)from_date,MAX(c.candle_date)to_date,c2.close latest_close,ca.d1_bias latest_bias FROM candles c LEFT JOIN candles c2 ON c2.symbol=c.symbol AND c2.candle_date=(SELECT MAX(candle_date)FROM candles WHERE symbol=c.symbol) LEFT JOIN candle_analysis ca ON ca.candle_id=c2.id GROUP BY c.symbol,c2.close,ca.d1_bias ORDER BY c.symbol`);
      return ok(res,r.rows);
    }

    const cmatch=urlPath.match(/^\/candles\/([A-Z0-9]+)$/);
    if (method==='GET' && cmatch) {
      auth(tok(req));
      const sym=cmatch[1],limit=Math.min(parseInt(qs.get('limit')||'500'),5000);
      const from=qs.get('from'),to=qs.get('to');
      let q=`SELECT candle_date,open,high,low,close,volume FROM candles WHERE symbol=$1`,p=[sym],i=2;
      if(from){q+=` AND candle_date>=$${i++}::date`;p.push(from);}
      if(to){q+=` AND candle_date<=$${i++}::date`;p.push(to);}
      q+=` ORDER BY candle_date DESC LIMIT $${i}`;p.push(limit);
      const r=await query(q,p);
      return ok(res,{symbol:sym,count:r.rows.length,candles:r.rows.reverse().map(c=>({date:c.candle_date,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume}))});
    }

    // ── REPORTS ──
    if (method==='GET' && urlPath==='/reports/latest') {
      auth(tok(req));
      const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.report_date=(SELECT MAX(report_date)FROM daily_reports)ORDER BY r.symbol`);
      return ok(res,r.rows);
    }

    const rsdMatch=urlPath.match(/^\/reports\/([A-Z0-9]+)\/(\d{4}-\d{2}-\d{2})$/);
    if (method==='GET' && rsdMatch) {
      auth(tok(req));
      const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 AND r.report_date=$2::date`,[rsdMatch[1],rsdMatch[2]]);
      if(!r.rows.length)return err(res,'Report not found.',404);
      return ok(res,r.rows[0]);
    }

    const rsMatch=urlPath.match(/^\/reports\/([A-Z0-9]+)$/);
    if (method==='GET' && rsMatch) {
      auth(tok(req));
      const sym=rsMatch[1],limit=Math.min(parseInt(qs.get('limit')||'60'),365);
      const r=await query(`SELECT r.*,c.open,c.high,c.low,c.close,ca.structure_label FROM daily_reports r JOIN candles c ON c.id=r.candle_id LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE r.symbol=$1 ORDER BY r.report_date DESC LIMIT $2`,[sym,limit]);
      return ok(res,r.rows);
    }

    // ── PUSH ──
    if (method==='GET' && urlPath==='/push/key') return ok(res,{key:vapidPublicKey()});

    if (method==='POST' && urlPath==='/push/subscribe') {
      const u=auth(tok(req));
      await subscribe(u.id,body.subscription,body.label);
      return ok(res,{ok:true});
    }

    if (method==='POST' && urlPath==='/push/unsubscribe') {
      auth(tok(req));await unsubscribe(body.endpoint);return ok(res,{ok:true});
    }

    // ── CRON ──
    if (method==='POST' && urlPath==='/cron/nightly') {
      const secret=req.headers['x-cron-secret']||body?.secret;
      if(!secret||secret!==process.env.CRON_SECRET)return err(res,'Unauthorized.',401);
      ok(res,{message:'Jobs started.'});
      setImmediate(()=>runNightlyJobs().catch(console.error));
      return;
    }

    return err(res,`No route: ${method} ${urlPath}`,404);

  } catch(e) {
    if(e.s)return err(res,e.m,e.s);
    console.error('Handler error:',e.message);
    return err(res,'Server error.',500);
  }
};

// ── NIGHTLY JOBS ──
async function runNightlyJobs() {
  console.log('▶ Nightly jobs');
  for(const sym of SYMBOLS){try{await classifyLatest(sym);}catch(e){console.error('Classify',sym,e.message);}}
  for(const sym of SYMBOLS){try{await refreshPatternStats(sym);}catch(e){console.error('Stats',sym,e.message);}}
  const reports=[];
  for(const sym of SYMBOLS){
    try{
      const r=await query(`SELECT c.*,ca.candle_type,ca.structure_label,ca.d1_bias,ca.bias_confidence FROM candles c JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 1`,[sym]);
      if(!r.rows.length)continue;
      const row=r.rows[0];
      const rep=await generateReport(sym,row,{candle_type:row.candle_type,structure_label:row.structure_label,d1_bias:row.d1_bias,bias_confidence:row.bias_confidence});
      await query(`INSERT INTO daily_reports(symbol,report_date,candle_id,candle_type,bias,bias_confidence,key_levels,report_text,short_summary,generated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT(symbol,report_date) DO UPDATE SET candle_type=$4,bias=$5,bias_confidence=$6,key_levels=$7,report_text=$8,short_summary=$9,generated_at=NOW()`,
        [sym,row.candle_date,row.id,rep.candle_type,rep.bias,rep.bias_confidence,JSON.stringify(rep.key_levels),rep.report_text,rep.short_summary]);
      reports.push(rep);
    }catch(e){console.error('Report',sym,e.message);}
  }
  await sendReportNotifications(reports).catch(console.error);
  console.log('✓ Done —',reports.length,'reports');
}

// Classify the latest candle only (for nightly job)
async function classifyLatest(symbol) {
  const res=await query(`SELECT c.*,ca.candle_type,ca.d1_bias,ca.structure_label,ca.id AS aid FROM candles c LEFT JOIN candle_analysis ca ON ca.candle_id=c.id WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 22`,[symbol]);
  if(!res.rows.length)return;
  const[today,...rest]=res.rows;
  if(!today.aid){
    const analysis=classifyCandle(today,rest[0]||null,rest.slice(0,20).reverse());
    await query(`INSERT INTO candle_analysis(candle_id,symbol,candle_date,candle_type,structure_label,body_pct,upper_wick_pct,lower_wick_pct,close_position,range_points,body_points,d1_bias,bias_confidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(candle_id) DO NOTHING`,
      [today.id,symbol,today.candle_date,analysis.candle_type,analysis.structure_label,analysis.body_pct,analysis.upper_wick_pct,analysis.lower_wick_pct,analysis.close_position,analysis.range_points,analysis.body_points,analysis.d1_bias,analysis.bias_confidence]);
  }
  if(rest[0]?.aid&&!rest[0]?.next_day_direction){
    const oc=classifyOutcome(rest[0].d1_bias,rest[0],today);
    await query(`UPDATE candle_analysis SET next_day_direction=$1,next_day_return_pct=$2,outcome_type=$3 WHERE id=$4`,[oc.next_day_direction,oc.next_day_return_pct,oc.outcome_type,rest[0].aid]);
  }
}

// Classify ALL unclassified candles for a symbol
async function classifyAll(symbol) {
  // Get all candles ordered oldest first
  const allCandles = await query(
    `SELECT c.*, ca.id AS aid, ca.d1_bias, ca.next_day_direction
     FROM candles c
     LEFT JOIN candle_analysis ca ON ca.candle_id = c.id
     WHERE c.symbol = $1
     ORDER BY c.candle_date ASC`,
    [symbol]
  );
  if (!allCandles.rows.length) return 0;
  const rows = allCandles.rows;
  let classified = 0;
  for (let i = 0; i < rows.length; i++) {
    const today = rows[i];
    const prev  = i > 0 ? rows[i-1] : null;
    const history = rows.slice(Math.max(0, i-20), i);
    // Classify if not yet done
    if (!today.aid) {
      const analysis = classifyCandle(today, prev, history);
      await query(
        `INSERT INTO candle_analysis(candle_id,symbol,candle_date,candle_type,structure_label,body_pct,upper_wick_pct,lower_wick_pct,close_position,range_points,body_points,d1_bias,bias_confidence)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(candle_id) DO NOTHING`,
        [today.id,symbol,today.candle_date,analysis.candle_type,analysis.structure_label,analysis.body_pct,analysis.upper_wick_pct,analysis.lower_wick_pct,analysis.close_position,analysis.range_points,analysis.body_points,analysis.d1_bias,analysis.bias_confidence]
      );
      classified++;
    }
    // Fill outcome for previous candle
    if (prev?.aid && !prev?.next_day_direction) {
      const oc = classifyOutcome(prev.d1_bias, prev, today);
      await query(`UPDATE candle_analysis SET next_day_direction=$1,next_day_return_pct=$2,outcome_type=$3 WHERE candle_id=$4`,
        [oc.next_day_direction, oc.next_day_return_pct, oc.outcome_type, prev.id]);
    }
  }
  console.log(`Classified ${classified} new candles for ${symbol}`);
  return classified;
}

// Generate reports for ALL days that have analysis but no report
async function generateMissingReports(symbol) {
  const rows = await query(
    `SELECT c.*, ca.candle_type, ca.structure_label, ca.d1_bias, ca.bias_confidence
     FROM candles c
     JOIN candle_analysis ca ON ca.candle_id = c.id
     WHERE c.symbol = $1
     AND NOT EXISTS (SELECT 1 FROM daily_reports dr WHERE dr.symbol = c.symbol AND dr.report_date = c.candle_date)
     ORDER BY c.candle_date ASC`,
    [symbol]
  );
  if (!rows.rows.length) { console.log(`No missing reports for ${symbol}`); return 0; }
  let generated = 0;
  for (const row of rows.rows) {
    try {
      const rep = await generateReport(symbol, row, {
        candle_type: row.candle_type, structure_label: row.structure_label,
        d1_bias: row.d1_bias, bias_confidence: row.bias_confidence
      });
      await query(
        `INSERT INTO daily_reports(symbol,report_date,candle_id,candle_type,bias,bias_confidence,key_levels,report_text,short_summary,generated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT(symbol,report_date) DO NOTHING`,
        [symbol, row.candle_date, row.id, rep.candle_type, rep.bias, rep.bias_confidence,
         JSON.stringify(rep.key_levels), rep.report_text, rep.short_summary]
      );
      generated++;
    } catch(e) { console.error(`Report error ${symbol} ${row.candle_date}:`, e.message); }
  }
  console.log(`Generated ${generated} missing reports for ${symbol}`);
  return generated;
}

// Full backfill: classify everything + generate all missing reports
async function runBackfill() {
  console.log('▶ Backfill started');
  for (const sym of SYMBOLS) {
    try { await classifyAll(sym); } catch(e) { console.error('ClassifyAll', sym, e.message); }
  }
  for (const sym of SYMBOLS) {
    try { await refreshPatternStats(sym); } catch(e) { console.error('Stats', sym, e.message); }
  }
  for (const sym of SYMBOLS) {
    try { await generateMissingReports(sym); } catch(e) { console.error('Reports', sym, e.message); }
  }
  console.log('✓ Backfill complete');
}
