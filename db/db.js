'use strict';
const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured. Set DATABASE_URL to your PostgreSQL connection string.');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3, // Keep low for serverless
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function initDb() {
  const schema = `
    CREATE TABLE IF NOT EXISTS candles (
      id           SERIAL PRIMARY KEY,
      symbol       TEXT NOT NULL,
      candle_date  DATE NOT NULL,
      open         NUMERIC(12,4) NOT NULL,
      high         NUMERIC(12,4) NOT NULL,
      low          NUMERIC(12,4) NOT NULL,
      close        NUMERIC(12,4) NOT NULL,
      volume       BIGINT DEFAULT 0,
      body_high    NUMERIC(12,4) GENERATED ALWAYS AS (GREATEST(open,close)) STORED,
      body_low     NUMERIC(12,4) GENERATED ALWAYS AS (LEAST(open,close)) STORED,
      direction    TEXT GENERATED ALWAYS AS (
        CASE WHEN close>open THEN 'bullish' WHEN close<open THEN 'bearish' ELSE 'neutral' END
      ) STORED,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(symbol, candle_date)
    );
    CREATE INDEX IF NOT EXISTS idx_candles_sym_date ON candles(symbol, candle_date DESC);

    CREATE TABLE IF NOT EXISTS candle_analysis (
      id                  SERIAL PRIMARY KEY,
      candle_id           INTEGER UNIQUE REFERENCES candles(id) ON DELETE CASCADE,
      symbol              TEXT NOT NULL,
      candle_date         DATE NOT NULL,
      candle_type         TEXT,
      structure_label     TEXT,
      body_pct            NUMERIC(6,2),
      upper_wick_pct      NUMERIC(6,2),
      lower_wick_pct      NUMERIC(6,2),
      close_position      NUMERIC(6,4),
      range_points        NUMERIC(10,4),
      body_points         NUMERIC(10,4),
      d1_bias             TEXT,
      bias_confidence     NUMERIC(5,2),
      next_day_direction  TEXT,
      next_day_return_pct NUMERIC(8,4),
      outcome_type        TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_sym_date ON candle_analysis(symbol, candle_date DESC);

    CREATE TABLE IF NOT EXISTS daily_reports (
      id              SERIAL PRIMARY KEY,
      symbol          TEXT NOT NULL,
      report_date     DATE NOT NULL,
      candle_id       INTEGER REFERENCES candles(id),
      candle_type     TEXT,
      bias            TEXT,
      bias_confidence NUMERIC(5,2),
      key_levels      JSONB,
      report_text     TEXT,
      short_summary   TEXT,
      generated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(symbol, report_date)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_sym_date ON daily_reports(symbol, report_date DESC);

    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT,
      role          TEXT DEFAULT 'user',
      status        TEXT DEFAULT 'active',
      last_login    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      subscription JSONB NOT NULL,
      device_label TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS pattern_stats (
      id                SERIAL PRIMARY KEY,
      symbol            TEXT NOT NULL,
      candle_type       TEXT NOT NULL,
      structure_context TEXT NOT NULL DEFAULT 'all',
      total_occurrences INTEGER DEFAULT 0,
      bullish_next_pct  NUMERIC(5,2),
      bearish_next_pct  NUMERIC(5,2),
      continuation_pct  NUMERIC(5,2),
      reversal_pct      NUMERIC(5,2),
      avg_next_return   NUMERIC(8,4),
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(symbol, candle_type, structure_context)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
    EXCEPTION WHEN OTHERS THEN NULL; END $$;
  `;
  await query(schema);
}

module.exports = { query, initDb };
