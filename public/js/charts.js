/* charts.js — Candlestick chart renderer using Lightweight Charts */
'use strict';

const KaizokuCharts = (() => {
  const charts = {};   // symbol -> { chart, series, data }
  const RANGES = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, 'ALL': 9999 };

  const CHART_OPTIONS = {
    layout: {
      background:   { color: '#0f1311' },
      textColor:    '#7a9088',
      fontSize:     11,
      fontFamily:   "'SF Mono','Consolas','Courier New',monospace",
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
    upColor:          '#3ecf8e',
    downColor:        '#e8534a',
    borderUpColor:    '#3ecf8e',
    borderDownColor:  '#e8534a',
    wickUpColor:      'rgba(62,207,142,0.6)',
    wickDownColor:    'rgba(232,83,74,0.6)',
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

window.KaizokuCharts = KaizokuCharts;
