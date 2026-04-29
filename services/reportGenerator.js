'use strict';

const { query } = require('../db/db');

// ═══════════════════════════════════════════
// REPORT GENERATOR
// Produces the daily narrative report for each symbol
// ═══════════════════════════════════════════

const SYMBOL_NAMES = {
  UK100:  'FTSE 100',
  DE30:   'DAX 40',
  GER30:  'DAX 40',
  XAUUSD: 'Gold',
  USOIL:  'US Crude Oil',
};

const PATTERN_DESCRIPTIONS = {
  strong_bullish:    'Strong Bullish Body',
  strong_bearish:    'Strong Bearish Body',
  moderate_bullish:  'Moderate Bullish',
  moderate_bearish:  'Moderate Bearish',
  bullish_pin_bar:   'Bullish Pin Bar',
  bearish_pin_bar:   'Bearish Pin Bar',
  hammer:            'Bullish Hammer',
  shooting_star:     'Shooting Star',
  bullish_engulfing: 'Bullish Engulfing',
  bearish_engulfing: 'Bearish Engulfing',
  inside_bar:        'Inside Bar',
  outside_bar:       'Outside Bar',
  doji:              'Doji',
  spinning_top:      'Spinning Top',
};

const BIAS_EMOJIS = { bullish: '▲', bearish: '▼', neutral: '↔' };

async function generateReport(symbol, candle, analysis) {
  const symbolName  = SYMBOL_NAMES[symbol] || symbol;
  const patternName = PATTERN_DESCRIPTIONS[analysis.candle_type] || analysis.candle_type;
  const biasEmoji   = BIAS_EMOJIS[analysis.d1_bias] || '↔';

  // Fetch pattern stats if available
  let stats = null;
  try {
    const statsRes = await query(
      `SELECT * FROM pattern_stats
       WHERE symbol=$1 AND candle_type=$2 AND structure_context=$3
       LIMIT 1`,
      [symbol, analysis.candle_type, analysis.structure_label]
    );
    if (statsRes.rows.length > 0) stats = statsRes.rows[0];
  } catch (e) { /* No stats yet — first run */ }

  const keyLevels = {
    high:      +candle.high,
    low:       +candle.low,
    close:     +candle.close,
    open:      +candle.open,
    body_high: +Math.max(candle.open, candle.close).toFixed(4),
    body_low:  +Math.min(candle.open, candle.close).toFixed(4),
  };

  // Build short summary (for notification)
  const shortSummary = buildShortSummary(symbol, symbolName, analysis, patternName, biasEmoji, keyLevels);

  // Build full report text
  const reportText  = buildFullReport(symbol, symbolName, candle, analysis, stats, patternName, biasEmoji, keyLevels);

  return {
    symbol,
    candle_id:        candle.id,
    candle_type:      analysis.candle_type,
    bias:             analysis.d1_bias,
    bias_confidence:  analysis.bias_confidence,
    key_levels:       keyLevels,
    short_summary:    shortSummary,
    report_text:      reportText,
  };
}

function buildShortSummary(symbol, symbolName, analysis, patternName, biasEmoji, levels) {
  const conf = analysis.bias_confidence;
  const bias = analysis.d1_bias;
  return `${biasEmoji} ${symbol} — ${patternName} · ${bias.charAt(0).toUpperCase()+bias.slice(1)} bias (${conf}%) · Close: ${levels.close}`;
}

function buildFullReport(symbol, symbolName, candle, analysis, stats, patternName, biasEmoji, levels) {
  const date      = new Date(candle.candle_date).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const bias      = analysis.d1_bias;
  const structure = analysis.structure_label;
  const conf      = analysis.bias_confidence;

  let text = `${symbolName} (${symbol}) — Daily Report\n`;
  text += `${date}\n\n`;
  text += `CANDLE: ${patternName}\n`;
  text += `BIAS: ${biasEmoji} ${bias.toUpperCase()} (${conf}% confidence)\n`;
  text += `STRUCTURE: ${structure.charAt(0).toUpperCase()+structure.slice(1)}\n\n`;

  text += `KEY LEVELS\n`;
  text += `Open:       ${levels.open}\n`;
  text += `High:       ${levels.high}\n`;
  text += `Low:        ${levels.low}\n`;
  text += `Close:      ${levels.close}\n`;
  text += `Body High:  ${levels.body_high}\n`;
  text += `Body Low:   ${levels.body_low}\n\n`;

  // Stats section
  if (stats && +stats.total_occurrences > 10) {
    text += `HISTORICAL CONTEXT (${stats.total_occurrences} occurrences)\n`;
    text += `Next day bullish: ${stats.bullish_next_pct}%\n`;
    text += `Next day bearish: ${stats.bearish_next_pct}%\n`;
    if (stats.continuation_pct) text += `Continuation: ${stats.continuation_pct}%\n`;
    if (stats.reversal_pct) text += `Reversal: ${stats.reversal_pct}%\n`;
    text += '\n';
  }

  // Narrative
  text += `ANALYSIS\n`;
  text += buildNarrative(symbol, symbolName, analysis, levels, stats, patternName, structure, bias, conf);

  return text;
}

function buildNarrative(symbol, symbolName, analysis, levels, stats, patternName, structure, bias, conf) {
  const narratives = {
    strong_bullish: () => {
      let t = `${symbolName} closed with a strong bullish body — buyers were firmly in control throughout the session with the close near the high of the range. `;
      if (structure === 'uptrend') t += `This pattern in an uptrend context has historically supported continuation. `;
      else if (structure === 'downtrend') t += `Despite the bearish trend, this strong close warrants attention — a potential shift in momentum. `;
      t += `Watch the body low at ${levels.body_low} as the key support zone. A move above ${levels.high} tomorrow confirms continuation. `;
      if (bias === 'bullish' && stats) t += `History shows ${stats.bullish_next_pct || '~65'}% next-day bullish for this pattern.`;
      return t;
    },
    strong_bearish: () => {
      let t = `${symbolName} closed with a strong bearish body — sellers dominated the session with price closing near the day's low. `;
      if (structure === 'downtrend') t += `Bearish continuation is the primary scenario. `;
      else if (structure === 'uptrend') t += `This is a warning sign for the uptrend — watch for follow-through tomorrow. `;
      t += `The body high at ${levels.body_high} becomes resistance. A sustained move below ${levels.low} targets lower levels. `;
      if (bias === 'bearish' && stats) t += `History shows ${stats.bearish_next_pct || '~65'}% next-day bearish for this pattern.`;
      return t;
    },
    bullish_pin_bar: () => {
      return `${symbolName} formed a bullish pin bar — price swept below intraday lows then rejected sharply, closing near the top of the range. The long lower wick at ${levels.low} signals strong buy pressure below. In ${structure} context, this pattern suggests a potential upside move. Entry watch: above ${levels.body_high}. Stop reference: ${levels.low}.`;
    },
    bearish_pin_bar: () => {
      return `${symbolName} formed a bearish pin bar — price pushed above intraday highs then rejected sharply, closing near the bottom of the range. The long upper wick at ${levels.high} signals strong sell pressure above. This rejection points to potential downside. Reference levels: body low ${levels.body_low}, wick high ${levels.high}.`;
    },
    hammer: () => {
      return `${symbolName} formed a hammer candle — a bullish reversal signal characterised by a long lower wick and small body near the top of the range. Price tested lows at ${levels.low} and was strongly rejected. In ${structure} context, watch for bullish follow-through above ${levels.high}.`;
    },
    shooting_star: () => {
      return `${symbolName} formed a shooting star — price pushed to ${levels.high} then was rejected sharply, closing near the lows. This bearish rejection at highs is a potential reversal signal. In ${structure} context, watch for bearish follow-through below ${levels.low}.`;
    },
    bullish_engulfing: () => {
      return `${symbolName} closed with a bullish engulfing pattern — today's candle body completely swallowed yesterday's bearish body, signalling a potential shift from sellers to buyers. The body range ${levels.body_low}–${levels.body_high} is the key zone. ${structure === 'downtrend' ? 'This could mark a bottom or temporary reversal in the downtrend.' : 'Bullish continuation is the primary scenario.'}`;
    },
    bearish_engulfing: () => {
      return `${symbolName} closed with a bearish engulfing pattern — today's candle body swallowed yesterday's bullish body. This shift signals potential seller takeover. Key zone: ${levels.body_low}–${levels.body_high}. ${structure === 'uptrend' ? 'This could mark a top or the beginning of a pullback.' : 'Bearish continuation is likely.'}`;
    },
    inside_bar: () => {
      return `${symbolName} formed an inside bar — today's full range sat within yesterday's range. This reflects market indecision and consolidation. The range ${levels.low}–${levels.high} is the current boundary. A break above ${levels.high} or below ${levels.low} will determine the next directional move.`;
    },
    doji: () => {
      return `${symbolName} closed as a doji — open and close are nearly identical, reflecting complete market indecision. Neither buyers nor sellers won today's session. The close at ${levels.close} is the pivot. No directional bias until tomorrow's session confirms a direction.`;
    },
    spinning_top: () => {
      return `${symbolName} formed a spinning top — a small body with wicks on both sides reflects indecision. The market tested both directions without commitment. In ${structure} context, this often precedes a continuation of the trend after a brief pause. No strong bias — watch for confirmation.`;
    },
  };

  const fn = narratives[analysis.candle_type];
  if (fn) return fn();

  // Generic fallback
  return `${symbolName} closed ${bias !== 'neutral' ? 'with a ' + analysis.candle_type.replace(/_/g,' ') + ' pattern' : 'indecisively'}. Key levels to watch: High ${levels.high} · Low ${levels.low} · Close ${levels.close}. Structure: ${structure}.`;
}

/**
 * Refresh pattern_stats table from candle_analysis history
 */
async function refreshPatternStats(symbol) {
  try {
    // Group by candle_type + structure_context
    await query(`
      INSERT INTO pattern_stats (symbol, candle_type, structure_context,
        total_occurrences, bullish_next_pct, bearish_next_pct,
        continuation_pct, reversal_pct, avg_next_return, updated_at)
      SELECT
        a.symbol,
        a.candle_type,
        COALESCE(a.structure_label, 'all') AS structure_context,
        COUNT(*) AS total_occurrences,
        ROUND(100.0 * SUM(CASE WHEN a.next_day_direction='bullish' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.next_day_direction),0),2) AS bullish_next_pct,
        ROUND(100.0 * SUM(CASE WHEN a.next_day_direction='bearish' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.next_day_direction),0),2) AS bearish_next_pct,
        ROUND(100.0 * SUM(CASE WHEN a.outcome_type='continuation' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.outcome_type),0),2) AS continuation_pct,
        ROUND(100.0 * SUM(CASE WHEN a.outcome_type='reversal' THEN 1 ELSE 0 END) / NULLIF(COUNT(a.outcome_type),0),2) AS reversal_pct,
        ROUND(AVG(a.next_day_return_pct)::numeric,4) AS avg_next_return,
        NOW()
      FROM candle_analysis a
      WHERE a.symbol = $1 AND a.next_day_direction IS NOT NULL
      GROUP BY a.symbol, a.candle_type, a.structure_label
      ON CONFLICT (symbol, candle_type, structure_context)
      DO UPDATE SET
        total_occurrences = EXCLUDED.total_occurrences,
        bullish_next_pct  = EXCLUDED.bullish_next_pct,
        bearish_next_pct  = EXCLUDED.bearish_next_pct,
        continuation_pct  = EXCLUDED.continuation_pct,
        reversal_pct      = EXCLUDED.reversal_pct,
        avg_next_return   = EXCLUDED.avg_next_return,
        updated_at        = NOW()
    `, [symbol]);

    console.log(`✓ Pattern stats refreshed for ${symbol}`);
  } catch (err) {
    console.error(`Pattern stats refresh error for ${symbol}:`, err.message);
  }
}

module.exports = { generateReport, refreshPatternStats };
