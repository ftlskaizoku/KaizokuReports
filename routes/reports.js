'use strict';

const router  = require('express').Router();
const { query } = require('../db/db');
const { authMiddleware } = require('./middleware');
const { runClassificationJob, runPatternStatsJob, runReportJob } = require('../services/scheduler');

// GET /api/reports/latest — today's report for all symbols
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT r.*, c.open, c.high, c.low, c.close
       FROM daily_reports r
       JOIN candles c ON c.id = r.candle_id
       WHERE r.report_date = (
         SELECT MAX(report_date) FROM daily_reports
       )
       ORDER BY r.symbol`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reports/:symbol — report history for a symbol
router.get('/:symbol', authMiddleware, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit  = Math.min(parseInt(req.query.limit) || 30, 365);

    const result = await query(
      `SELECT r.*, c.open, c.high, c.low, c.close
       FROM daily_reports r
       JOIN candles c ON c.id = r.candle_id
       WHERE r.symbol=$1
       ORDER BY r.report_date DESC
       LIMIT $2`,
      [symbol, limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reports/:symbol/:date
router.get('/:symbol/:date', authMiddleware, async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const date   = req.params.date;

    const result = await query(
      `SELECT r.*, c.open, c.high, c.low, c.close,
              ca.body_pct, ca.upper_wick_pct, ca.lower_wick_pct,
              ca.close_position, ca.structure_label
       FROM daily_reports r
       JOIN candles c ON c.id = r.candle_id
       LEFT JOIN candle_analysis ca ON ca.candle_id = c.id
       WHERE r.symbol=$1 AND r.report_date=$2::date`,
      [symbol, date]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/reports/run — manually trigger the nightly jobs (admin only)
router.post('/run', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    res.json({ message: 'Jobs started — check server logs' });
    // Run after response sent
    setImmediate(async () => {
      await runClassificationJob();
      await runPatternStatsJob();
      await runReportJob();
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
