<<<<<<< HEAD
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
=======
/* charts.js — Candlestick chart renderer using Lightweight Charts */
'use strict';

const KaizokuCharts = (() => {
  const charts = {};   // symbol -> { chart, series, data }
  const RANGES = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, 'ALL': 9999 };

  const CHART_OPTIONS = {
    layout: {
      background:   { color: '#13141c' },
      textColor:    '#8b8eab',
      fontSize:     11,
      fontFamily:   "'IBM Plex Mono','Consolas','Courier New',monospace",
    },
    grid: {
      vertLines: { color: '#1c2420', style: 1 },
      horzLines: { color: '#1c2420', style: 1 },
    },
    crosshair: {
      mode: 0, // Normal
      vertLine: { color: '#3d5049', labelBackgroundColor: '#151a17' },
      horzLine: { color: '#3d5049', labelBackgroundColor: '#151a17' },
    },
    rightPriceScale: {
      borderColor: '#1c2420',
      textColor:   '#7a9088',
    },
    timeScale: {
      borderColor:      '#1c2420',
      textColor:        '#7a9088',
      timeVisible:      true,
      secondsVisible:   false,
    },
    handleScroll:  true,
    handleScale:   true,
  };

  const CANDLE_OPTIONS = {
    upColor:          '#34d399',
    downColor:        '#f87171',
    borderUpColor:    '#34d399',
    borderDownColor:  '#f87171',
    wickUpColor:      'rgba(52,211,153,0.55)',
    wickDownColor:    'rgba(248,113,113,0.55)',
  };

  function initChart(symbol, containerId, allData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Destroy existing if re-init
    if (charts[symbol]) {
      charts[symbol].chart.remove();
      delete charts[symbol];
    }

    const chart = LightweightCharts.createChart(container, {
      ...CHART_OPTIONS,
      width:  container.clientWidth,
      height: container.clientHeight,
    });

    const series = chart.addCandlestickSeries(CANDLE_OPTIONS);

    // Transform data for lightweight-charts
    const formatted = formatCandles(allData);
    series.setData(formatted);

    // Fit all content
    chart.timeScale().fitContent();

    // Crosshair tooltip
    chart.subscribeCrosshairMove(param => {
      updateTooltip(symbol, param, series);
    });

    // Responsive resize
    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width:  container.clientWidth,
        height: container.clientHeight,
      });
    });
    ro.observe(container);

    charts[symbol] = { chart, series, data: allData, allData, ro };

    return chart;
  }

  function formatCandles(data) {
    return data.map(c => ({
      time:  formatDate(c.date),
      open:  +c.open,
      high:  +c.high,
      low:   +c.low,
      close: +c.close,
    })).sort((a, b) => (a.time > b.time ? 1 : -1));
  }

  function formatDate(d) {
    // Accept Date, string, or timestamp
    const date = new Date(d);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function setRange(symbol, days) {
    const state = charts[symbol];
    if (!state) return;

    const all = state.allData;
    let filtered = all;

    if (days < 9999) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      filtered = all.filter(c => new Date(c.date) >= cutoff);
    }

    const formatted = formatCandles(filtered);
    state.series.setData(formatted);
    state.chart.timeScale().fitContent();
    state.data = filtered;
  }

  function updateTooltip(symbol, param, series) {
    const el = document.getElementById(`chart-tooltip-${symbol}`);
    if (!el) return;

    if (!param.time || !param.seriesData || !param.seriesData.get(series)) {
      el.style.display = 'none';
      return;
    }

    const d = param.seriesData.get(series);
    const change = d.close - d.open;
    const pct    = ((change / d.open) * 100).toFixed(2);
    const dir    = change >= 0 ? 'up' : 'dn';

    el.style.display   = 'flex';
    el.innerHTML = `
      <span>O <strong>${fmtPrice(d.open)}</strong></span>
      <span>H <strong>${fmtPrice(d.high)}</strong></span>
      <span>L <strong>${fmtPrice(d.low)}</strong></span>
      <span>C <strong>${fmtPrice(d.close)}</strong></span>
      <span class="${dir}"><strong>${change >= 0 ? '+' : ''}${pct}%</strong></span>`;
  }

  function fmtPrice(v) {
    return v >= 1000 ? v.toFixed(2) : v >= 10 ? v.toFixed(3) : v.toFixed(4);
  }

  function destroyChart(symbol) {
    if (charts[symbol]) {
      charts[symbol].ro.disconnect();
      charts[symbol].chart.remove();
      delete charts[symbol];
    }
  }

  return { initChart, setRange, destroyChart, charts };
})();

>>>>>>> 8063827b3b7f4f57abff358a4d5a4b65aeb2d382
window.KaizokuCharts = KaizokuCharts;
