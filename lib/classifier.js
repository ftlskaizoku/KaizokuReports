'use strict';

function classifyCandle(c, prev, history = []) {
  const { open, high, low, close } = c;
  const range = high - low;
  const bodyHigh = Math.max(open, close), bodyLow = Math.min(open, close);
  const body = bodyHigh - bodyLow;
  const upperWick = high - bodyHigh, lowerWick = bodyLow - low;
  const bodyPct = range > 0 ? (body / range) * 100 : 0;
  const upperWickPct = range > 0 ? (upperWick / range) * 100 : 0;
  const lowerWickPct = range > 0 ? (lowerWick / range) * 100 : 0;
  const closePos = range > 0 ? (close - low) / range : 0.5;
  const isBull = close > open, isBear = close < open;
  const structure = detectStructure(history);

  let type = 'spinning_top';
  if (bodyPct < 5) type = 'doji';
  else if (bodyPct < 20 && upperWickPct > 15 && lowerWickPct > 15) type = 'spinning_top';
  else if (prev) {
    const ctx = classifyContextual(c, prev);
    if (ctx) type = ctx;
    else type = basePattern({ bodyPct, upperWickPct, lowerWickPct, closePos, isBull, isBear });
  } else type = basePattern({ bodyPct, upperWickPct, lowerWickPct, closePos, isBull, isBear });

  const { bias, confidence } = deriveBias(type, structure);
  return {
    candle_type: type, structure_label: structure,
    body_pct: +bodyPct.toFixed(2), upper_wick_pct: +upperWickPct.toFixed(2),
    lower_wick_pct: +lowerWickPct.toFixed(2), close_position: +closePos.toFixed(4),
    range_points: +range.toFixed(4), body_points: +body.toFixed(4),
    d1_bias: bias, bias_confidence: confidence,
  };
}

function basePattern({ bodyPct, upperWickPct, lowerWickPct, closePos, isBull, isBear }) {
  if (lowerWickPct > 60 && closePos > 0.5) return 'bullish_pin_bar';
  if (upperWickPct > 60 && closePos < 0.5) return 'bearish_pin_bar';
  if (bodyPct < 25 && lowerWickPct > 50 && closePos > 0.6 && isBull) return 'hammer';
  if (bodyPct < 25 && upperWickPct > 50 && closePos < 0.4 && isBear) return 'shooting_star';
  if (bodyPct > 70 && closePos > 0.7 && isBull) return 'strong_bullish';
  if (bodyPct > 70 && closePos < 0.3 && isBear) return 'strong_bearish';
  if (bodyPct >= 40 && isBull) return 'moderate_bullish';
  if (bodyPct >= 40 && isBear) return 'moderate_bearish';
  return isBull ? 'moderate_bullish' : 'moderate_bearish';
}

function classifyContextual(c, prev) {
  if (!prev) return null;
  const ch = Math.max(c.open, c.close), cl = Math.min(c.open, c.close);
  const ph = Math.max(prev.open, prev.close), pl = Math.min(prev.open, prev.close);
  const cBull = c.close > c.open, pBull = prev.close > prev.open;
  if (c.high <= prev.high && c.low >= prev.low) return 'inside_bar';
  if (c.high > prev.high && c.low < prev.low) return 'outside_bar';
  if (cBull && !pBull && ch > ph && cl < pl) return 'bullish_engulfing';
  if (!cBull && pBull && cl < pl && ch > ph) return 'bearish_engulfing';
  return null;
}

function detectStructure(history) {
  if (history.length < 10) return 'ranging';
  const closes = history.map(c => +c.close);
  const half = Math.floor(closes.length / 2);
  const avg1 = closes.slice(0, half).reduce((a,b) => a+b,0) / half;
  const avg2 = closes.slice(half).reduce((a,b) => a+b,0) / (closes.length - half);
  const highs = history.map(c => +c.high).slice(-5);
  const lows  = history.map(c => +c.low).slice(-5);
  const hh = highs.filter((h,i) => i > 0 && h > highs[i-1]).length;
  const ll = lows.filter((l,i) => i > 0 && l < lows[i-1]).length;
  if (avg2 > avg1 * 1.005 && hh >= 2) return 'uptrend';
  if (avg2 < avg1 * 0.995 && ll >= 2) return 'downtrend';
  return 'ranging';
}

function deriveBias(type, structure) {
  const bullTypes = ['strong_bullish','bullish_pin_bar','hammer','bullish_engulfing','moderate_bullish'];
  const bearTypes = ['strong_bearish','bearish_pin_bar','shooting_star','bearish_engulfing','moderate_bearish'];
  const conf = { strong_bullish:72,strong_bearish:72,bullish_pin_bar:68,bearish_pin_bar:65,bullish_engulfing:64,bearish_engulfing:66,hammer:61,shooting_star:60,moderate_bullish:57,moderate_bearish:57,inside_bar:54,outside_bar:52,doji:49,spinning_top:49 };
  const boost = { uptrend:{bull:4,bear:-4}, downtrend:{bull:-4,bear:4}, ranging:{bull:0,bear:0} };
  const b = boost[structure] || boost.ranging;
  let bias = 'neutral', c = conf[type] || 50;
  if (bullTypes.includes(type)) { bias = 'bullish'; c += b.bull; }
  else if (bearTypes.includes(type)) { bias = 'bearish'; c += b.bear; }
  if (c < 52) bias = 'neutral';
  return { bias, confidence: +Math.min(95, Math.max(44, c)).toFixed(1) };
}

function classifyOutcome(prevBias, prevCandle, todayCandle) {
  const ret = ((todayCandle.close - prevCandle.close) / prevCandle.close) * 100;
  const dir = todayCandle.close > prevCandle.close ? 'bullish' : 'bearish';
  let outcomeType = 'consolidation';
  if (Math.abs(ret) >= 0.25) {
    outcomeType = dir === prevBias ? 'continuation' : Math.abs(ret) >= 0.5 ? 'reversal' : 'pullback';
  }
  return { next_day_direction: dir, next_day_return_pct: +ret.toFixed(4), outcome_type: outcomeType };
}

module.exports = { classifyCandle, classifyOutcome };
