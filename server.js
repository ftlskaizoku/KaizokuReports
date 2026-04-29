'use strict';

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const { initDb }  = require('./db/db');
const { startScheduler } = require('./services/scheduler');

const app   = express();
const PORT  = process.env.PORT || 3000;

// ═══ SECURITY ═══
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:   ["'self'"],
      scriptSrc:    ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "unpkg.com"],
      styleSrc:     ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:      ["'self'", "fonts.gstatic.com"],
      connectSrc:   ["'self'"],
      imgSrc:       ["'self'", "data:"],
      workerSrc:    ["'self'"],
      manifestSrc:  ["'self'"],
    }
  }
}));

app.use(cors({
  origin: process.env.APP_URL || true,
  credentials: true,
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));

// ═══ RATE LIMITING ═══
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const eaLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 120,
});

// ═══ ROUTES ═══
app.use('/api/auth',    apiLimiter, require('./routes/auth'));
app.use('/api/ea',      eaLimiter,  require('./routes/ea'));
app.use('/api/candles', apiLimiter, require('./routes/candles'));
app.use('/api/reports', apiLimiter, require('./routes/reports'));
app.use('/api/push',    apiLimiter, require('./routes/push'));

// ═══ HEALTH CHECK ═══
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ═══ SERVE FRONTEND ═══
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
}));

// SPA fallback — all non-API routes serve index.html
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
  startScheduler();

  app.listen(PORT, () => {
    console.log(`\n🚀 Kaizoku Reports running on port ${PORT}`);
    console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   URL: ${process.env.APP_URL || 'http://localhost:' + PORT}\n`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
