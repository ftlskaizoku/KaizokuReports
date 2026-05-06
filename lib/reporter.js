'use strict';
const{query}=require('./db');
const NAMES={UK100:'FTSE 100',DE30:'DAX 40',XAUUSD:'Gold (XAU/USD)',USOIL:'US Crude Oil'};
const PATS={strong_bullish:'Strong Bullish Body',strong_bearish:'Strong Bearish Body',moderate_bullish:'Moderate Bullish',moderate_bearish:'Moderate Bearish',bullish_pin_bar:'Bullish Pin Bar',bearish_pin_bar:'Bearish Pin Bar',hammer:'Bullish Hammer',shooting_star:'Shooting Star',bullish_engulfing:'Bullish Engulfing',bearish_engulfing:'Bearish Engulfing',inside_bar:'Inside Bar',outside_bar:'Outside Bar',doji:'Doji',spinning_top:'Spinning Top'};

// Build one report — accepts pre-fetched statsMap to avoid per-candle DB calls
function buildReport(symbol, candle, analysis, statsMap) {
  const name=NAMES[symbol]||symbol;
  const pat=PATS[analysis.candle_type]||analysis.candle_type?.replace(/_/g,' ');
  const kl={
    open:+candle.open, high:+candle.high, low:+candle.low, close:+candle.close,
    body_high:+Math.max(candle.open,candle.close).toFixed(4),
    body_low:+Math.min(candle.open,candle.close).toFixed(4)
  };
  const b=analysis.d1_bias, emoji={bullish:'▲',bearish:'▼',neutral:'↔'}[b]||'↔';
  const statsKey = `${analysis.candle_type}`;
  const stats = statsMap ? statsMap[statsKey] : null;
  const suf = stats&&+stats.total_occurrences>10
    ? ` Historical data: ${stats.bullish_next_pct||'—'}% bullish / ${stats.bearish_next_pct||'—'}% bearish next day (${stats.total_occurrences} cases).`
    : '';

  const map={
    strong_bullish:`${name} closed with a strong bullish body — buyers controlled with close near the high. Body: ${kl.body_low}–${kl.body_high}. ${analysis.structure_label==='uptrend'?'Bullish continuation is primary scenario.':analysis.structure_label==='downtrend'?'Potential shift — watch for follow-through.':''}${suf}`,
    strong_bearish:`${name} closed with a strong bearish body — sellers dominated near the low. Body: ${kl.body_low}–${kl.body_high}. ${analysis.structure_label==='downtrend'?'Bearish continuation expected.':'Warning — watch for follow-through below '+kl.low+'.'}${suf}`,
    bullish_pin_bar:`${name} formed a bullish pin bar — swept below ${kl.low} then rejected sharply. Strong buy pressure below. Potential upside toward ${kl.high}.${suf}`,
    bearish_pin_bar:`${name} formed a bearish pin bar — pushed above ${kl.high} then rejected. Sell pressure above ${kl.body_high}. Watch for bearish follow-through.${suf}`,
    hammer:`${name} formed a hammer — long lower wick from ${kl.low}, body near top. Bullish rejection. Watch confirmation above ${kl.high}.${suf}`,
    shooting_star:`${name} formed a shooting star — tested ${kl.high} then rejected sharply. Bearish. Watch for follow-through below ${kl.low}.${suf}`,
    bullish_engulfing:`${name} bullish engulfing — today's candle covered yesterday's bearish body. Potential buyer takeover. Zone: ${kl.body_low}–${kl.body_high}.${suf}`,
    bearish_engulfing:`${name} bearish engulfing — swallowed yesterday's bullish body. Potential seller takeover. Zone: ${kl.body_low}–${kl.body_high}.${suf}`,
    inside_bar:`${name} formed an inside bar — range (${kl.low}–${kl.high}) within yesterday's. Consolidation. Break of either side determines next direction.`,
    doji:`${name} doji — open and close nearly identical at ${kl.close}. Complete indecision. Wait for tomorrow's candle.`,
    spinning_top:`${name} spinning top — small body, wicks both sides. Indecision in ${analysis.structure_label} context.`,
  };
  const narrative=map[analysis.candle_type]||`${name} closed at ${kl.close}. Structure: ${analysis.structure_label}. H ${kl.high} · L ${kl.low}.`;
  const short=`${emoji} ${symbol} — ${pat} · ${b} (${analysis.bias_confidence}%) · Close: ${kl.close}`;
  const text=`${name} (${symbol}) — Daily Report\n${new Date(candle.candle_date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}\n\nCANDLE: ${pat}\nBIAS: ${emoji} ${b?.toUpperCase()} (${analysis.bias_confidence}%)\nSTRUCTURE: ${analysis.structure_label}\n\nKEY LEVELS\nOpen: ${kl.open} · High: ${kl.high} · Low: ${kl.low} · Close: ${kl.close}\nBody: ${kl.body_low} – ${kl.body_high}\n\nANALYSIS\n${narrative}`;
  return{symbol,candle_id:candle.id,candle_type:analysis.candle_type,bias:b,bias_confidence:analysis.bias_confidence,key_levels:kl,short_summary:short,report_text:text};
}

// Single report with DB stats lookup (for nightly job - just 1 candle)
async function generateReport(symbol, candle, analysis) {
  let statsMap = {};
  try {
    const r = await query(`SELECT candle_type, total_occurrences, bullish_next_pct, bearish_next_pct FROM pattern_stats WHERE symbol=$1`,[symbol]);
    r.rows.forEach(s => { statsMap[s.candle_type] = s; });
  } catch{}
  return buildReport(symbol, candle, analysis, statsMap);
}

// Fetch all stats for a symbol once, return map
async function fetchStatsMap(symbol) {
  try {
    const r = await query(`SELECT candle_type, total_occurrences, bullish_next_pct, bearish_next_pct FROM pattern_stats WHERE symbol=$1`,[symbol]);
    const map = {};
    r.rows.forEach(s => { map[s.candle_type] = s; });
    return map;
  } catch { return {}; }
}

async function refreshPatternStats(symbol){
  try{await query(`INSERT INTO pattern_stats(symbol,candle_type,structure_context,total_occurrences,bullish_next_pct,bearish_next_pct,continuation_pct,reversal_pct,avg_next_return,updated_at) SELECT a.symbol,a.candle_type,COALESCE(a.structure_label,'all'),COUNT(*),ROUND(100.0*SUM(CASE WHEN a.next_day_direction='bullish' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.next_day_direction),0),2),ROUND(100.0*SUM(CASE WHEN a.next_day_direction='bearish' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.next_day_direction),0),2),ROUND(100.0*SUM(CASE WHEN a.outcome_type='continuation' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.outcome_type),0),2),ROUND(100.0*SUM(CASE WHEN a.outcome_type='reversal' THEN 1 ELSE 0 END)/NULLIF(COUNT(a.outcome_type),0),2),ROUND(AVG(a.next_day_return_pct)::numeric,4),NOW() FROM candle_analysis a WHERE a.symbol=$1 AND a.next_day_direction IS NOT NULL GROUP BY a.symbol,a.candle_type,a.structure_label ON CONFLICT(symbol,candle_type,structure_context) DO UPDATE SET total_occurrences=EXCLUDED.total_occurrences,bullish_next_pct=EXCLUDED.bullish_next_pct,bearish_next_pct=EXCLUDED.bearish_next_pct,continuation_pct=EXCLUDED.continuation_pct,reversal_pct=EXCLUDED.reversal_pct,avg_next_return=EXCLUDED.avg_next_return,updated_at=NOW()`,[symbol]);}
  catch(e){console.error('Stats refresh:',e.message);}
}

module.exports={generateReport,buildReport,fetchStatsMap,refreshPatternStats};
