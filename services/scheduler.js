'use strict';

const cron      = require('node-cron');
const { query } = require('../db/db');
const { classifyCandle, classifyContextualPattern, classifyOutcome } = require('./candleClassifier');
const { generateReport, refreshPatternStats } = require('./reportGenerator');
const { sendDailyReportNotifications } = require('./pushNotifications');

const SYMBOLS = ['UK100', 'DE30', 'XAUUSD', 'USOIL'];

// ═══════════════════════════════════════════
// NIGHTLY JOB CHAIN
// 22:15 — Classify today's candles + update yesterday's outcome
// 22:20 — Refresh pattern stats
// 22:30 — Generate reports + send push notifications
// ═══════════════════════════════════════════

async function runClassificationJob() {
  console.log('⏱ Running D1 classification job...');
  for (const symbol of SYMBOLS) {
    try {
      await classifyLatestCandle(symbol);
    } catch (err) {
      console.error(`Classification error for ${symbol}:`, err.message);
    }
  }
  console.log('✓ Classification job complete');
}

async function classifyLatestCandle(symbol) {
  // Get the two most recent candles
  const res = await query(
    `SELECT c.*, ca.candle_type, ca.d1_bias, ca.structure_label, ca.id as analysis_id
     FROM candles c
     LEFT JOIN candle_analysis ca ON ca.candle_id = c.id
     WHERE c.symbol=$1
     ORDER BY c.candle_date DESC
     LIMIT 22`,
    [symbol]
  );
  if (res.rows.length === 0) return;

  const rows    = res.rows;
  const today   = rows[0];
  const prev    = rows[1] || null;
  const history = rows.slice(1, 21).reverse(); // oldest first

  // Skip if already classified today
  if (today.analysis_id) {
    // Still update yesterday's outcome if needed
    if (prev && prev.analysis_id && !prev.next_day_direction) {
      const outcome = classifyOutcome(prev, prev, today);
      await query(
        `UPDATE candle_analysis SET next_day_direction=$1, next_day_return_pct=$2, outcome_type=$3
         WHERE id=$4`,
        [outcome.next_day_direction, outcome.next_day_return_pct, outcome.outcome_type, prev.analysis_id]
      );
    }
    return;
  }

  // Classify today's candle
  const analysis = classifyCandle(today, prev, history);

  // Check for contextual pattern (engulfing, inside bar)
  if (prev) {
    const contextual = classifyContextualPattern(today, prev);
    if (contextual) analysis.candle_type = contextual;
  }

  // Insert analysis
  await query(
    `INSERT INTO candle_analysis
     (candle_id, symbol, candle_date, candle_type, structure_label,
      body_pct, upper_wick_pct, lower_wick_pct, close_position,
      range_points, body_points, d1_bias, bias_confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (candle_id) DO NOTHING`,
    [
      today.id, symbol, today.candle_date,
      analysis.candle_type, analysis.structure_label,
      analysis.body_pct, analysis.upper_wick_pct, analysis.lower_wick_pct,
      analysis.close_position, analysis.range_points, analysis.body_points,
      analysis.d1_bias, analysis.bias_confidence,
    ]
  );

  // Update yesterday's outcome
  if (prev && prev.analysis_id) {
    const outcome = classifyOutcome({ d1_bias: prev.d1_bias }, prev, today);
    await query(
      `UPDATE candle_analysis SET next_day_direction=$1, next_day_return_pct=$2, outcome_type=$3
       WHERE id=$4`,
      [outcome.next_day_direction, outcome.next_day_return_pct, outcome.outcome_type, prev.analysis_id]
    );
  }

  console.log(`  ✓ ${symbol}: ${analysis.candle_type} · ${analysis.d1_bias} (${analysis.bias_confidence}%)`);
}

async function runPatternStatsJob() {
  console.log('⏱ Refreshing pattern stats...');
  for (const symbol of SYMBOLS) {
    await refreshPatternStats(symbol).catch(err =>
      console.error(`Stats error for ${symbol}:`, err.message)
    );
  }
  console.log('✓ Pattern stats complete');
}

async function runReportJob() {
  console.log('⏱ Generating daily reports...');
  const generated = [];

  for (const symbol of SYMBOLS) {
    try {
      // Get latest candle + analysis
      const res = await query(
        `SELECT c.*, ca.*
         FROM candles c
         JOIN candle_analysis ca ON ca.candle_id = c.id
         WHERE c.symbol=$1
         ORDER BY c.candle_date DESC
         LIMIT 1`,
        [symbol]
      );
      if (res.rows.length === 0) continue;

      const row     = res.rows[0];
      const candle  = { id: row.id, open: row.open, high: row.high, low: row.low, close: row.close, candle_date: row.candle_date };
      const analysis = {
        candle_type: row.candle_type, structure_label: row.structure_label,
        d1_bias: row.d1_bias, bias_confidence: row.bias_confidence,
      };

      const report = await generateReport(symbol, candle, analysis);

      // Upsert report
      await query(
        `INSERT INTO daily_reports
         (symbol, report_date, candle_id, candle_type, bias, bias_confidence,
          key_levels, report_text, short_summary, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (symbol, report_date)
         DO UPDATE SET
           candle_type=$4, bias=$5, bias_confidence=$6,
           key_levels=$7, report_text=$8, short_summary=$9, generated_at=NOW()`,
        [
          symbol, row.candle_date, candle.id,
          report.candle_type, report.bias, report.bias_confidence,
          JSON.stringify(report.key_levels), report.report_text, report.short_summary,
        ]
      );

      generated.push(report);
      console.log(`  ✓ Report generated for ${symbol}`);
    } catch (err) {
      console.error(`Report error for ${symbol}:`, err.message);
    }
  }

  // Send push notifications
  if (generated.length > 0) {
    await sendDailyReportNotifications(generated).catch(err =>
      console.error('Push notification error:', err.message)
    );
  }

  console.log('✓ Report job complete');
}

function startScheduler() {
  // 22:15 UTC — Classify candles
  cron.schedule('15 22 * * 1-5', runClassificationJob, { timezone: 'UTC' });

  // 22:20 UTC — Pattern stats
  cron.schedule('20 22 * * 1-5', runPatternStatsJob, { timezone: 'UTC' });

  // 22:30 UTC — Generate reports + push notifications
  cron.schedule('30 22 * * 1-5', runReportJob, { timezone: 'UTC' });

  console.log('✓ Scheduler started (Mon–Fri: classify 22:15, stats 22:20, report 22:30 UTC)');
}

module.exports = {
  startScheduler,
  runClassificationJob,
  runPatternStatsJob,
  runReportJob,
};
