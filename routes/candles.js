'use strict';

const router  = require('express').Router();
const { query } = require('../db/db');
const { authMiddleware } = require('./middleware');

// GET /api/candles/:symbol — get candles for chart
// Query params: limit (default 500), from, to (ISO date strings)
router.get('/:symbol', authMiddleware, async (req, res) => {
  try {
    const symbol  = req.params.symbol.toUpperCase();
    const limit   = Math.min(parseInt(req.query.limit) || 500, 5000);
    const from    = req.query.from;
    const to      = req.query.to;

    let q     = `SELECT candle_date, open, high, low, close, volume FROM candles WHERE symbol=$1`;
    const params  = [symbol];
    let idx   = 2;

    if (from) { q += ` AND candle_date >= $${idx++}::date`; params.push(from); }
    if (to)   { q += ` AND candle_date <= $${idx++}::date`; params.push(to); }

    q += ` ORDER BY candle_date DESC LIMIT $${idx}`;
    params.push(limit);

    const result = await query(q, params);

    // Return in chronological order for charting
    const candles = result.rows.reverse().map(r => ({
      date:   r.candle_date,
      open:   +r.open,
      high:   +r.high,
      low:    +r.low,
      close:  +r.close,
      volume: +r.volume,
    }));

    res.json({ symbol, count: candles.length, candles });
  } catch (err) {
    console.error('Candles error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/candles/:symbol/latest — most recent candle
router.get('/:symbol/latest', authMiddleware, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const result = await query(
      `SELECT c.*, ca.candle_type, ca.d1_bias, ca.bias_confidence, ca.structure_label
       FROM candles c
       LEFT JOIN candle_analysis ca ON ca.candle_id = c.id
       WHERE c.symbol=$1 ORDER BY c.candle_date DESC LIMIT 1`,
      [symbol]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No data' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/candles/summary — quick stats for all symbols
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT c.symbol,
         COUNT(*) as total_candles,
         MIN(c.candle_date) as from_date,
         MAX(c.candle_date) as to_date,
         c2.close as latest_close,
         ca.candle_type as latest_type,
         ca.d1_bias as latest_bias,
         ca.bias_confidence as latest_confidence
       FROM candles c
       LEFT JOIN candles c2 ON c2.symbol = c.symbol AND c2.candle_date = (
         SELECT MAX(candle_date) FROM candles WHERE symbol = c.symbol
       )
       LEFT JOIN candle_analysis ca ON ca.candle_id = c2.id
       GROUP BY c.symbol, c2.close, ca.candle_type, ca.d1_bias, ca.bias_confidence
       ORDER BY c.symbol`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
