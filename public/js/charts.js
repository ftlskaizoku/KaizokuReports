'use strict';
const KaizokuCharts = (() => {
  const charts = {};
  const OPT = {
    layout:{ background:{color:'#161724'}, textColor:'#9295b8', fontSize:11, fontFamily:"'IBM Plex Mono',monospace" },
    grid:{ vertLines:{color:'#252840',style:1}, horzLines:{color:'#252840',style:1} },
    crosshair:{ vertLine:{color:'#555875',labelBackgroundColor:'#1b1d2c'}, horzLine:{color:'#555875',labelBackgroundColor:'#1b1d2c'} },
    rightPriceScale:{ borderColor:'#252840', textColor:'#9295b8' },
    timeScale:{ borderColor:'#252840', textColor:'#9295b8', timeVisible:true, secondsVisible:false },
    handleScroll:true, handleScale:true,
  };
  const CANDLE_OPT = { upColor:'#34d399', downColor:'#f87171', borderUpColor:'#34d399', borderDownColor:'#f87171', wickUpColor:'rgba(52,211,153,.55)', wickDownColor:'rgba(248,113,113,.55)' };

  function initChart(symbol, containerId, data) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (charts[symbol]) { charts[symbol].chart.remove(); delete charts[symbol]; }
    const chart  = LightweightCharts.createChart(el, { ...OPT, width:el.clientWidth, height:el.clientHeight });
    const series = chart.addCandlestickSeries(CANDLE_OPT);
    const fmt    = formatData(data);
    series.setData(fmt);
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width:el.clientWidth, height:el.clientHeight }));
    ro.observe(el);
    charts[symbol] = { chart, series, allData:data, ro };
  }

  function formatData(data) {
    return data.map(c => ({ time:fmtDate(c.date), open:+c.open, high:+c.high, low:+c.low, close:+c.close }))
               .sort((a,b) => a.time > b.time ? 1 : -1);
  }

  function fmtDate(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }

  function setRange(symbol, days) {
    const s = charts[symbol]; if (!s) return;
    let data = s.allData;
    if (days < 9999) { const cut = new Date(); cut.setDate(cut.getDate()-days); data = data.filter(c => new Date(c.date) >= cut); }
    s.series.setData(formatData(data));
    s.chart.timeScale().fitContent();
  }

  function destroyChart(symbol) {
    if (charts[symbol]) { charts[symbol].ro.disconnect(); charts[symbol].chart.remove(); delete charts[symbol]; }
  }

  return { initChart, setRange, destroyChart };
})();
window.KaizokuCharts = KaizokuCharts;
