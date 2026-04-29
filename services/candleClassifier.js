'use strict';

// ═══════════════════════════════════════════
// CANDLE CLASSIFIER
// Derives all metrics and assigns a pattern label
// to a daily candle
// ═══════════════════════════════════════════

const CANDLE_TYPES = {
  STRONG_BULLISH:     'strong_bullish',
  STRONG_BEARISH:     'strong_bearish',
  MODERATE_BULLISH:   'moderate_bullish',
  MODERATE_BEARISH:   'moderate_bearish',
  BULLISH_PIN_BAR:    'bullish_pin_bar',
  BEARISH_PIN_BAR:    'bearish_pin_bar',
  HAMMER:             'hammer',
  SHOOTING_STAR:      'shooting_star',
  BULLISH_ENGULFING:  'bullish_engulfing',
  BEARISH_ENGULFING:  'bearish_engulfing',
  INSIDE_BAR:         'inside_bar',
  OUTSIDE_BAR:        'outside_bar',
  DOJI:               'doji',
  SPINNING_TOP:       'spinning_top',
};

/**
 * Classify a single candle and derive all metrics
 * @param {Object} candle - { open, high, low, close }
 * @param {Object|null} prevCandle - previous candle for contextual patterns
 * @param {Array} history - array of last 20 candles for structure detection
 * @returns {Object} derived fields + candle_type + structure_label + d1_bias
 */
function classifyCandle(candle, prevCandle = null, history = []) {
  const { open, high, low, close } = candle;

  const range       = high - low;
  const bodyHigh    = Math.max(open, close);
  const bodyLow     = Math.min(open, close);
  const body        = bodyHigh - bodyLow;
  const upperWick   = high - bodyHigh;
  const lowerWick   = bodyLow - low;

  // Avoid division by zero
  const bodyPct       = range > 0 ? (body / range) * 100 : 0;
  const upperWickPct  = range > 0 ? (upperWick / range) * 100 : 0;
  const lowerWickPct  = range > 0 ? (lowerWick / range) * 100 : 0;
  const closePosition = range > 0 ? (close - low) / range : 0.5;

  const isBullish = close > open;
  const isBearish = close < open;

  // ── Structure label from last 20 candles ──
  const structureLabel = detectStructure(history);

  // ── Pattern classification ──
  let candleType = classifyPattern(
    { open, high, low, close, body, bodyHigh, bodyLow, upperWick, lowerWick,
      bodyPct, upperWickPct, lowerWickPct, closePosition, isBullish, isBearish },
    prevCandle
  );

  // ── Bias ──
  const { bias, confidence } = deriveBias(candleType, structureLabel);

  return {
    candle_type:      candleType,
    structure_label:  structureLabel,
    body_pct:         +bodyPct.toFixed(2),
    upper_wick_pct:   +upperWickPct.toFixed(2),
    lower_wick_pct:   +lowerWickPct.toFixed(2),
    close_position:   +closePosition.toFixed(4),
    range_points:     +range.toFixed(4),
    body_points:      +body.toFixed(4),
    d1_bias:          bias,
    bias_confidence:  confidence,
  };
}

function classifyPattern(c, prev) {
  const { bodyPct, upperWickPct, lowerWickPct, closePosition, isBullish, isBearish } = c;

  // ── Doji (body < 5% of range) ──
  if (bodyPct < 5) return CANDLE_TYPES.DOJI;

  // ── Spinning top (body 5-20%, both wicks present) ──
  if (bodyPct < 20 && upperWickPct > 15 && lowerWickPct > 15) return CANDLE_TYPES.SPINNING_TOP;

  // ── Contextual patterns (need prev candle) ──
  if (prev) {
    const prevBody  = Math.abs(prev.close - prev.open);
    const currBody  = Math.abs(c.close - c.open); // note: c is the metrics obj here
    // We need actual prices for engulfing — skipping if not available
    // (These are set when called with full candle objects)
  }

  // ── Bullish Pin Bar (long lower wick rejection) ──
  if (lowerWickPct > 60 && closePosition > 0.5) return CANDLE_TYPES.BULLISH_PIN_BAR;

  // ── Bearish Pin Bar (long upper wick rejection) ──
  if (upperWickPct > 60 && closePosition < 0.5) return CANDLE_TYPES.BEARISH_PIN_BAR;

  // ── Hammer (small body upper half, long lower wick) ──
  if (bodyPct < 25 && lowerWickPct > 50 && closePosition > 0.6 && isBullish) return CANDLE_TYPES.HAMMER;

  // ── Shooting Star (small body lower half, long upper wick) ──
  if (bodyPct < 25 && upperWickPct > 50 && closePosition < 0.4 && isBearish) return CANDLE_TYPES.SHOOTING_STAR;

  // ── Strong Bullish (body > 70%, close in top 30%) ──
  if (bodyPct > 70 && closePosition > 0.7 && isBullish) return CANDLE_TYPES.STRONG_BULLISH;

  // ── Strong Bearish (body > 70%, close in bottom 30%) ──
  if (bodyPct > 70 && closePosition < 0.3 && isBearish) return CANDLE_TYPES.STRONG_BEARISH;

  // ── Moderate Bullish ──
  if (bodyPct >= 40 && isBullish) return CANDLE_TYPES.MODERATE_BULLISH;

  // ── Moderate Bearish ──
  if (bodyPct >= 40 && isBearish) return CANDLE_TYPES.MODERATE_BEARISH;

  // Fallback
  return isBullish ? CANDLE_TYPES.MODERATE_BULLISH : CANDLE_TYPES.MODERATE_BEARISH;
}

/**
 * Classify engulfing and inside/outside bar using actual price data
 * Called separately when we have prev candle with full OHLC
 */
function classifyContextualPattern(candle, prevCandle) {
  if (!prevCandle) return null;

  const currBodyHigh  = Math.max(candle.open, candle.close);
  const currBodyLow   = Math.min(candle.open, candle.close);
  const prevBodyHigh  = Math.max(prevCandle.open, prevCandle.close);
  const prevBodyLow   = Math.min(prevCandle.open, prevCandle.close);
  const isBullish     = candle.close > candle.open;
  const isBearish     = candle.close < candle.open;
  const prevBullish   = prevCandle.close > prevCandle.open;
  const prevBearish   = prevCandle.close < prevCandle.open;

  // Inside bar
  if (candle.high <= prevCandle.high && candle.low >= prevCandle.low) return CANDLE_TYPES.INSIDE_BAR;

  // Outside bar
  if (candle.high > prevCandle.high && candle.low < prevCandle.low) return CANDLE_TYPES.OUTSIDE_BAR;

  // Bullish engulfing
  if (isBullish && prevBearish && currBodyHigh > prevBodyHigh && currBodyLow < prevBodyLow) return CANDLE_TYPES.BULLISH_ENGULFING;

  // Bearish engulfing
  if (isBearish && prevBullish && currBodyLow < prevBodyLow && currBodyHigh > prevBodyHigh) return CANDLE_TYPES.BEARISH_ENGULFING;

  return null;
}

function detectStructure(history) {
  if (history.length < 10) return 'ranging';

  const closes  = history.map(c => +c.close);
  const highs   = history.map(c => +c.high);
  const lows    = history.map(c => +c.low);
  const len     = closes.length;

  // Simple SMA comparison
  const half    = Math.floor(len / 2);
  const firstHalf   = closes.slice(0, half);
  const secondHalf  = closes.slice(half);
  const avgFirst    = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond   = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  // Check HH/HL for uptrend, LH/LL for downtrend
  const recentHighs = highs.slice(-5);
  const recentLows  = lows.slice(-5);
  const hhCount = recentHighs.filter((h, i) => i > 0 && h > recentHighs[i - 1]).length;
  const llCount = recentLows.filter((l, i) => i > 0 && l < recentLows[i - 1]).length;

  if (avgSecond > avgFirst * 1.005 && hhCount >= 2) return 'uptrend';
  if (avgSecond < avgFirst * 0.995 && llCount >= 2) return 'downtrend';
  return 'ranging';
}

function deriveBias(candleType, structure) {
  const bullishPatterns = [
    CANDLE_TYPES.STRONG_BULLISH, CANDLE_TYPES.BULLISH_PIN_BAR,
    CANDLE_TYPES.HAMMER, CANDLE_TYPES.BULLISH_ENGULFING, CANDLE_TYPES.MODERATE_BULLISH,
  ];
  const bearishPatterns = [
    CANDLE_TYPES.STRONG_BEARISH, CANDLE_TYPES.BEARISH_PIN_BAR,
    CANDLE_TYPES.SHOOTING_STAR, CANDLE_TYPES.BEARISH_ENGULFING, CANDLE_TYPES.MODERATE_BEARISH,
  ];

  // Base confidence by type
  const confidenceMap = {
    strong_bullish: 72, strong_bearish: 72,
    bullish_pin_bar: 68, bearish_pin_bar: 65,
    bullish_engulfing: 64, bearish_engulfing: 66,
    hammer: 61, shooting_star: 60,
    moderate_bullish: 57, moderate_bearish: 57,
    inside_bar: 54, outside_bar: 52,
    doji: 49, spinning_top: 49,
  };

  // Structure boost/penalty
  const structureBoost = {
    uptrend: { bullish: +4, bearish: -4 },
    downtrend: { bullish: -4, bearish: +4 },
    ranging: { bullish: 0, bearish: 0 },
  };

  let bias = 'neutral';
  let confidence = confidenceMap[candleType] || 50;

  if (bullishPatterns.includes(candleType)) {
    bias = 'bullish';
    confidence += (structureBoost[structure] || structureBoost.ranging).bullish;
  } else if (bearishPatterns.includes(candleType)) {
    bias = 'bearish';
    confidence += (structureBoost[structure] || structureBoost.ranging).bearish;
  }

  // Override if confidence too low
  if (confidence < 52) bias = 'neutral';
  confidence = Math.min(95, Math.max(44, confidence));

  return { bias, confidence: +confidence.toFixed(1) };
}

/**
 * Classify outcome: fill next_day fields on the previous row
 * @param {Object} prevAnalysis - previous day's analysis
 * @param {Object} todayCandle - today's candle (just closed)
 */
function classifyOutcome(prevAnalysis, prevCandle, todayCandle) {
  const returnPct = ((todayCandle.close - prevCandle.close) / prevCandle.close) * 100;
  const direction = todayCandle.close > prevCandle.close ? 'bullish' : 'bearish';

  let outcomeType = 'consolidation';
  const threshold = 0.25;

  if (Math.abs(returnPct) >= threshold) {
    // Continuation: today moved in same direction as prev candle's bias
    if (direction === prevAnalysis.d1_bias) {
      outcomeType = 'continuation';
    } else {
      // Could be reversal or pullback — look at magnitude
      if (Math.abs(returnPct) >= 0.5) {
        outcomeType = 'reversal';
      } else {
        outcomeType = 'pullback';
      }
    }
  }

  return {
    next_day_direction: direction,
    next_day_return_pct: +returnPct.toFixed(4),
    outcome_type: outcomeType,
  };
}

module.exports = {
  classifyCandle,
  classifyContextualPattern,
  classifyOutcome,
  CANDLE_TYPES,
};
