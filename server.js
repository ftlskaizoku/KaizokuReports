'use strict';

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const { initDb }         = require('./db/db');
const { startScheduler } = require('./services/scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

// ═══ GUARD: DATABASE_URL must be set ═══
if (!process.env.DATABASE_URL) {
  console.error('\n❌ DATABASE_URL is not set.');
  console.error('   In Railway: PostgreSQL plugin → Connect tab → copy DATABASE_URL');
  console.error('   Then: KaizokuReports service → Variables → add DATABASE_URL\n');
  process.exit(1);
}

// ═══ SECURITY ═══
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc:    ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:     ["'self'", "fonts.gstatic.com"],
      connectSrc:  ["'self'"],
      imgSrc:      ["'self'", "data:"],
      workerSrc:   ["'self'"],
      manifestSrc: ["'self'"],
    }
  }
}));

app.use(cors({ origin: process.env.APP_URL || true, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// ═══ RATE LIMITING ═══
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
const eaLimiter  = rateLimit({ windowMs:  1 * 60 * 1000, max: 120 });

// ═══ ROUTES ═══
app.use('/api/setup',   apiLimiter, require('./routes/setup'));
app.use('/api/auth',    apiLimiter, require('./routes/auth'));
app.use('/api/admin',   apiLimiter, require('./routes/admin'));
app.use('/api/ea',      eaLimiter,  require('./routes/ea'));
app.use('/api/candles', apiLimiter, require('./routes/candles'));
app.use('/api/reports', apiLimiter, require('./routes/reports'));
app.use('/api/push',    apiLimiter, require('./routes/push'));

// ═══ HEALTH ═══
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ═══ FRONTEND ═══
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true }));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ═══ ERROR HANDLER ═══
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ═══ STARTUP ═══
async function start() {
  // Init DB schema — this is the first real DB call
  // If DATABASE_URL is wrong/missing this will throw a clear error
  try {
    await initDb();
    console.log('✓ Database connected');
  } catch (err) {
    console.error('\n❌ Database connection failed:', err.message);
    console.error('   Check DATABASE_URL in Railway Variables\n');
    process.exit(1);
  }

  // EA key is generated lazily on first use — no startup call needed
  startScheduler();

  app.listen(PORT, () => {
    console.log(`\n🚀 Kaizoku Reports — port ${PORT}`);
    console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   URL: ${process.env.APP_URL || 'http://localhost:' + PORT}\n`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
