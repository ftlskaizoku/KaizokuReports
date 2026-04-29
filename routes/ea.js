'use strict';

const router  = require('express').Router();
const { query } = require('../db/db');
const { eaAuthMiddleware } = require('./middleware');

const VALID_SYMBOLS = ['UK100', 'DE30', 'GER30', 'XAUUSD', 'USOIL'];

// Alias normalisation — broker may send different names
const SYMBOL_ALIASES = {
  'GER30': 'DE30', 'GER40': 'DE30', 'DE40': 'DE30',
  'DAX': 'DE30', 'DAX40': 'DE30',
  'UK100': 'UK100', 'FTSE': 'UK100', 'FTSE100': 'UK100',
  'XAUUSD': 'XAUUSD', 'GOLD': 'XAUUSD',
  'USOIL': 'USOIL', 'WTI': 'USOIL', 'OIL': 'USOIL',
  'CRUDE': 'USOIL', 'USOIL+': 'USOIL',
};

function normaliseSymbol(raw) {
  const upper = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SYMBOL_ALIASES[upper] || (VALID_SYMBOLS.includes(upper) ? upper : null);
}

function validateCandle(c) {
  const { symbol, date, open, high, low, close } = c;
  if (!symbol || !date) return 'symbol and date required';
  if (isNaN(+open) || isNaN(+high) || isNaN(+low) || isNaN(+close)) return 'invalid OHLC values';
  if (+high < +low) return 'high cannot be less than low';
  if (+open <= 0 || +close <= 0) return 'prices must be positive';
  return null;
}

// POST /api/ea/push — single candle or batch
router.post('/push', eaAuthMiddleware, async (req, res) => {
  try {
    const body    = req.body;
    const candles = Array.isArray(body) ? body : [body];

    if (candles.length === 0) {
      return res.status(400).json({ error: 'No candles provided' });
    }

    if (candles.length > 5000) {
      return res.status(400).json({ error: 'Maximum 5000 candles per request' });
    }

    const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    for (const c of candles) {
      const symbol = normaliseSymbol(c.symbol);
      if (!symbol) {
        results.errors.push(`Unknown symbol: ${c.symbol}`);
        results.skipped++;
        continue;
      }

      const err = validateCandle({ ...c, symbol });
      if (err) {
        results.errors.push(`${symbol} ${c.date}: ${err}`);
        results.skipped++;
        continue;
      }

      try {
        const r = await query(
          `INSERT INTO candles (symbol, candle_date, open, high, low, close, volume)
           VALUES ($1, $2::date, $3, $4, $5, $6, $7)
           ON CONFLICT (symbol, candle_date)
           DO UPDATE SET
             open=EXCLUDED.open, high=EXCLUDED.high,
             low=EXCLUDED.low, close=EXCLUDED.close,
             volume=EXCLUDED.volume, updated_at=NOW()
           RETURNING (xmax = 0) AS inserted`,
          [symbol, c.date, +c.open, +c.high, +c.low, +c.close, +(c.volume || 0)]
        );

        if (r.rows[0]?.inserted) results.inserted++;
        else results.updated++;

      } catch (dbErr) {
        results.errors.push(`DB error for ${symbol} ${c.date}: ${dbErr.message}`);
        results.skipped++;
      }
    }

    const status = results.errors.length > 0 && results.inserted === 0 ? 207 : 200;
    res.status(status).json({
      message:  `Processed ${candles.length} candle(s)`,
      inserted: results.inserted,
      updated:  results.updated,
      skipped:  results.skipped,
      errors:   results.errors.slice(0, 20), // cap errors in response
    });

  } catch (err) {
    console.error('EA push error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/ea/status — EA can ping this to confirm connection
router.get('/status', eaAuthMiddleware, async (req, res) => {
  try {
    const counts = await query(
      `SELECT symbol, COUNT(*) as total, MAX(candle_date) as latest
       FROM candles GROUP BY symbol ORDER BY symbol`
    );
    res.json({
      status:  'connected',
      symbols: counts.rows,
      time:    new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
