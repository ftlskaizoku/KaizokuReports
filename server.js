'use strict';

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const { initDb }        = require('./db/db');
const { startScheduler } = require('./services/scheduler');
const { getEAKey }       = require('./services/settingsService');

const app  = express();
const PORT = process.env.PORT || 3000;

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
const eaLimiter  = rateLimit({ windowMs: 1  * 60 * 1000, max: 120 });

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
  await initDb();
  await getEAKey(); // Ensure EA key exists in DB on every startup
  startScheduler();

  app.listen(PORT, () => {
    console.log(`\n🚀 Kaizoku Reports — port ${PORT}`);
    console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   URL: ${process.env.APP_URL || 'http://localhost:' + PORT}\n`);
  });
}

start().catch(err => { console.error('Fatal startup error:', err); process.exit(1); });
