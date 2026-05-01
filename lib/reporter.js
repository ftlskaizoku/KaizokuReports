'use strict';
const { query } = require('./db');

const NAMES = { UK100:'FTSE 100', DE30:'DAX 40', XAUUSD:'Gold (XAU/USD)', USOIL:'US Crude Oil' };
const PATTERNS = { strong_bullish:'Strong Bullish Body', strong_bearish:'Strong Bearish Body', moderate_bullish:'Moderate Bullish', moderate_bearish:'Moderate Bearish', bullish_pin_bar:'Bullish Pin Bar', bearish_pin_bar:'Bearish Pin Bar', hammer:'Bullish Hammer', shooting_star:'Shooting Star', bullish_engulfing:'Bullish Engulfing', bearish_engulfing:'Bearish Engulfing', inside_bar:'Inside Bar', outside_bar:'Outside Bar', doji:'Doji', spinning_top:'Spinning Top' };

async function generateReport(symbol, candle, analysis) {
  const name = NAMES[symbol] || symbol;
  const pat  = PATTERNS[analysis.candle_type] || analysis.candle_type?.replace(/_/g,' ');
  const kl   = { open:+candle.open, high:+candle.high, low:+candle.low, close:+candle.close, body_high:+Math.max(candle.open,candle.close).toFixed(4), body_low:+Math.min(candle.open,candle.close).toFixed(4) };
  const b    = analysis.d1_bias, emoji = {bullish:'▲',bearish:'▼',neutral:'↔'}[b]||'↔';
  const short = `${emoji} ${symbol} — ${pat} · ${b} (${analysis.bias_confidence}%) · Close: ${kl.close}`;

  let stats = null;
  try { const r = await query(`SELECT * FROM pattern_stats WHERE symbol=$1 AND candle_type=$2 LIMIT 1`,[symbol,analysis.candle_type]); stats = r.rows[0]||null; } catch {}

  const narrative = buildNarrative(symbol, name, analysis, kl, stats, pat);
  const text = `${name} (${symbol}) — Daily Report\n${new Date(candle.candle_date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}\n\nCANDLE: ${pat}\nBIAS: ${emoji} ${b?.toUpperCase()} (${analysis.bias_confidence}% confidence)\nSTRUCTURE: ${analysis.structure_label}\n\nKEY LEVELS\nOpen: ${kl.open} · High: ${kl.high} · Low: ${kl.low} · Close: ${kl.close}\nBody: ${kl.body_low} – ${kl.body_high}\n\nANALYSIS\n${narrative}`;

  return { symbol, candle_id:candle.id, candle_type:analysis.candle_type, bias:b, bias_confidence:analysis.bias_confidence, key_levels:kl, short_summary:short, report_text:text };
}

function buildNarrative(symbol, name, analysis, kl, stats, pat) {
  const b = analysis.d1_bias, s = analysis.structure_label;
  const suf = stats && +stats.total_occurrences>10 ? ` Historical data shows ${stats.bullish_next_pct||'—'}% bullish / ${stats.bearish_next_pct||'—'}% bearish next day across ${stats.total_occurrences} similar cases.` : '';
  const map = {
    strong_bullish: `${name} closed with a strong bullish body — buyers controlled the session with the close near the high. Body zone: ${kl.body_low}–${kl.body_high}. ${s==='uptrend'?'Bullish continuation is the primary scenario.':s==='downtrend'?'A potential shift in momentum — watch for follow-through.':''} Watch the body low at ${kl.body_low} as key support today.${suf}`,
    strong_bearish:  `${name} closed with a strong bearish body — sellers dominated with price closing near the low. Body zone: ${kl.body_low}–${kl.body_high}. ${s==='downtrend'?'Bearish continuation expected.':'A warning sign — watch for follow-through below '+ kl.low+'.'}${suf}`,
    bullish_pin_bar: `${name} formed a bullish pin bar — price swept below ${kl.low} then rejected sharply, closing near the top of range. The long lower wick signals strong buy pressure below. Potential upside move toward ${kl.high}.${suf}`,
    bearish_pin_bar: `${name} formed a bearish pin bar — price pushed above ${kl.high} then rejected sharply, closing near range lows. Upper wick signals sell pressure above ${kl.body_high}. Watch for bearish follow-through.${suf}`,
    hammer:          `${name} formed a hammer — long lower wick from ${kl.low} with body near the top of range. Bullish rejection signal. In ${s} context, watch for confirmation above ${kl.high}.${suf}`,
    shooting_star:   `${name} formed a shooting star — price tested ${kl.high} then rejected sharply. Bearish signal. Watch for follow-through below ${kl.low}.${suf}`,
    bullish_engulfing:`${name} closed with a bullish engulfing pattern — today's candle completely covered yesterday's bearish body. Potential buyer takeover. Zone: ${kl.body_low}–${kl.body_high}.${suf}`,
    bearish_engulfing:`${name} closed with a bearish engulfing pattern — today's candle swallowed yesterday's bullish body. Potential seller takeover. Zone: ${kl.body_low}–${kl.body_high}.${suf}`,
    inside_bar:      `${name} formed an inside bar — today's range (${kl.low}–${kl.high}) sits within yesterday's. Consolidation. A break of either side determines the next directional move.`,
    doji:            `${name} closed as a doji — open and close nearly identical at ${kl.close}. Complete market indecision. Wait for tomorrow's candle to confirm direction.`,
    spinning_top:    `${name} formed a spinning top — small body with wicks both sides. Indecision in ${s} context. Often precedes a continuation after a pause.`,
  };
  return map[analysis.candle_type] || `${name} closed at ${kl.close}. Structure: ${s}. Key levels: H ${kl.high} · L ${kl.low}.`;
}

async function refreshPatternStats(symbol) {
  try {
    await query(`
      INSERT INTO pattern_stats (symbol,candle_type,structure_context,total_occurrences,bullish_next_pct,bearish_next_pct,continuation_pct,reversal_pct,avg_next_return,updated_at)
      SELECT a.symbol,a.candle_type,COALESCE(a.structure_label,'all'),COUNT(*),
        ROUND(100.0*SUM(CASE WHEN a.next_day_direction='bullish' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.next_day_direction),0),2),
        ROUND(100.0*SUM(CASE WHEN a.next_day_direction='bearish' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.next_day_direction),0),2),
        ROUND(100.0*SUM(CASE WHEN a.outcome_type='continuation' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.outcome_type),0),2),
        ROUND(100.0*SUM(CASE WHEN a.outcome_type='reversal' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.outcome_type),0),2),
        ROUND(AVG(a.next_day_return_pct)::numeric,4),NOW()
      FROM candle_analysis a WHERE a.symbol=$1 AND a.next_day_direction IS NOT NULL
      GROUP BY a.symbol,a.candle_type,a.structure_label
      ON CONFLICT (symbol,candle_type,structure_context) DO UPDATE SET
        total_occurrences=EXCLUDED.total_occurrences,bullish_next_pct=EXCLUDED.bullish_next_pct,
        bearish_next_pct=EXCLUDED.bearish_next_pct,continuation_pct=EXCLUDED.continuation_pct,
        reversal_pct=EXCLUDED.reversal_pct,avg_next_return=EXCLUDED.avg_next_return,updated_at=NOW()
    `,[symbol]);
  } catch(e) { console.error('Stats refresh error:',e.message); }
}

module.exports = { generateReport, refreshPatternStats };
