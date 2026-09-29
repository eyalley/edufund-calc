/* ============================================================
   charts.js – Chart.js integration for Investment Comparison
   Exposes global ChartManager
   ============================================================ */

// Global defaults
Chart.defaults.font.family = 'Heebo, sans-serif';
Chart.defaults.color = '#9090b0';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

const ChartManager = (function () {
  'use strict';

  // ── colour palette ──────────────────────────────────────────
  const COLORS = {
    scenarioA: '#6366f1',       // indigo
    scenarioAFill: 'rgba(99,102,241,0.10)',
    scenarioB: '#06b6d4',       // cyan
    scenarioBFill: 'rgba(6,182,212,0.10)',
    scenarioC: '#10b981',       // emerald green
    scenarioCFill: 'rgba(16,185,129,0.10)',
    warning: '#f59e0b',         // tax / warning
    warningFill: 'rgba(245,158,11,0.15)',
    success: '#10b981',         // net received
    successFill: 'rgba(16,185,129,0.15)',
    grid: 'rgba(255,255,255,0.06)',
  };

  // ── internal chart instance store ───────────────────────────
  const charts = {};

  // ── helpers ─────────────────────────────────────────────────

  /** Format a number as ₪ with Hebrew locale */
  function fmtCurrency(val) {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(val);
  }

  /**
   * Down-sample an array so it never exceeds `maxPoints`.
   * Always keeps the first and last element.
   */
  function sampleData(arr, maxPoints) {
    if (!arr || arr.length <= maxPoints) return arr;
    const step = Math.ceil(arr.length / maxPoints);
    const sampled = [];
    for (let i = 0; i < arr.length; i += step) {
      sampled.push(arr[i]);
    }
    // Ensure the very last point is included
    if (sampled[sampled.length - 1] !== arr[arr.length - 1]) {
      sampled.push(arr[arr.length - 1]);
    }
    return sampled;
  }

  /**
   * Build X-axis labels that show 'התחלה' for month 0 and 'שנה X' every 12 months.
   * Returns an array of labels the same length as `maxLen`.
   */
  function buildMonthLabels(maxLen) {
    const labels = [];
    for (let m = 0; m < maxLen; m++) {
      if (m === 0) {
        labels.push('התחלה');
      } else if (m % 12 === 0) {
        labels.push('שנה ' + (m / 12));
      } else {
        labels.push(m.toString());
      }
    }
    return labels;
  }

  /**
   * When datasets differ in length, pad shorter ones with `null`
   * and return a common set of labels. Supports 2 or 3 datasets.
   */
  function alignDatasets(aArr, bArr, cArr) {
    cArr = cArr || [];
    const maxLen = Math.max(aArr.length, bArr.length, cArr.length);
    const a = aArr.slice();
    const b = bArr.slice();
    const c = cArr.slice();
    while (a.length < maxLen) a.push(null);
    while (b.length < maxLen) b.push(null);
    while (c.length < maxLen) c.push(null);
    return { a, b, c, labels: buildMonthLabels(maxLen) };
  }

  /**
   * Apply down-sampling to aligned datasets + labels together so indices stay in sync.
   */
  function prepareLineData(aRaw, bRaw, cRaw, maxPoints) {
    if (typeof cRaw === 'number') {
      maxPoints = cRaw;
      cRaw = null;
    }
    const { a, b, c, labels } = alignDatasets(aRaw, bRaw, cRaw);
    if (a.length <= maxPoints) return { a, b, c, labels };

    const step = Math.ceil(a.length / maxPoints);
    const sa = [], sb = [], sc = [], sl = [];
    for (let i = 0; i < a.length; i += step) {
      sa.push(a[i]);
      sb.push(b[i]);
      sc.push(c[i]);
      sl.push(labels[i]);
    }
    const last = a.length - 1;
    if (sa.length === 0 || sa[sa.length - 1] !== a[last]) {
      sa.push(a[last]);
      sb.push(b[last]);
      sc.push(c[last]);
      sl.push(labels[last]);
    }
    return { a: sa, b: sb, c: sc, labels: sl };
  }

  /** Whether animation should be disabled for large datasets */
  function shouldAnimate(len) {
    return len <= 500;
  }

  // ── shared tooltip config ───────────────────────────────────
  function currencyTooltip() {
    return {
      rtl: true,
      textDirection: 'rtl',
      callbacks: {
        label: function (ctx) {
          return ctx.dataset.label + ': ' + fmtCurrency(ctx.parsed.y);
        },
      },
    };
  }

  // ── shared scales config for line charts ────────────────────
  function lineScales() {
    return {
      x: {
        reverse: false,              // Left to right (Month 0 / Start on left)
        grid: { color: COLORS.grid },
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 20,
        },
        title: {
          display: true,
          text: 'חודש',
        },
      },
      y: {
        grid: { color: COLORS.grid },
        ticks: {
          callback: function (val) {
            return fmtCurrency(val);
          },
        },
      },
    };
  }

  // ── chart factory helpers ───────────────────────────────────

  function ensureCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.error('[ChartManager] Canvas not found:', canvasId);
      return null;
    }
    return canvas.getContext('2d');
  }

  function storeChart(canvasId, instance) {
    if (charts[canvasId]) {
      charts[canvasId].destroy();
    }
    charts[canvasId] = instance;
  }

  // ── public API ──────────────────────────────────────────────

  /**
   * Destroy all existing chart instances to prevent memory leaks.
   */
  function destroyAll() {
    Object.keys(charts).forEach(function (key) {
      if (charts[key]) {
        charts[key].destroy();
        delete charts[key];
      }
    });
  }

  /**
   * 1. Balance Chart (Line) – remaining balance over time.
   */
  function createBalanceChart(canvasId, scenarioAData, scenarioBData, scenarioCData) {
    const ctx = ensureCanvas(canvasId);
    if (!ctx) return;

    const aRaw = scenarioAData.map(function (d) { return d.remainingBalance; });
    const bRaw = scenarioBData.map(function (d) { return d.remainingBalance; });
    const cRaw = scenarioCData ? scenarioCData.map(function (d) { return d.remainingBalance; }) : null;
    const maxPts = 200;
    const prepared = prepareLineData(aRaw, bRaw, cRaw, maxPts);
    const animate = shouldAnimate(Math.max(aRaw.length, bRaw.length, cRaw ? cRaw.length : 0));

    const datasets = [
      {
        label: 'תרחיש א׳ – המשך קרן',
        data: prepared.a,
        borderColor: COLORS.scenarioA,
        backgroundColor: COLORS.scenarioAFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      },
      {
        label: 'תרחיש ב׳ – העברה לכלי חדש',
        data: prepared.b,
        borderColor: COLORS.scenarioB,
        backgroundColor: COLORS.scenarioBFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      },
    ];

    if (scenarioCData) {
      datasets.push({
        label: 'תרחיש ג׳ – פיצול תיקים',
        data: prepared.c,
        borderColor: COLORS.scenarioC,
        backgroundColor: COLORS.scenarioCFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      });
    }

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: prepared.labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animate ? {} : false,
        plugins: {
          legend: { position: 'top', rtl: true, textDirection: 'rtl' },
          tooltip: currencyTooltip(),
        },
        scales: lineScales(),
      },
    });

    storeChart(canvasId, chart);
  }

  /**
   * 2. Cumulative Tax Chart (Line) – tax paid over time.
   */
  function createTaxChart(canvasId, scenarioAData, scenarioBData, scenarioCData) {
    const ctx = ensureCanvas(canvasId);
    if (!ctx) return;

    const aRaw = scenarioAData.map(function (d) { return d.cumulativeTax; });
    const bRaw = scenarioBData.map(function (d) { return d.cumulativeTax; });
    const cRaw = scenarioCData ? scenarioCData.map(function (d) { return d.cumulativeTax; }) : null;
    const maxPts = 200;
    const prepared = prepareLineData(aRaw, bRaw, cRaw, maxPts);
    const animate = shouldAnimate(Math.max(aRaw.length, bRaw.length, cRaw ? cRaw.length : 0));

    const datasets = [
      {
        label: 'מס מצטבר – תרחיש א׳',
        data: prepared.a,
        borderColor: COLORS.scenarioA,
        backgroundColor: COLORS.scenarioAFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      },
      {
        label: 'מס מצטבר – תרחיש ב׳',
        data: prepared.b,
        borderColor: COLORS.warning,
        backgroundColor: COLORS.warningFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      },
    ];

    if (scenarioCData) {
      datasets.push({
        label: 'מס מצטבר – תרחיש ג׳',
        data: prepared.c,
        borderColor: COLORS.scenarioC,
        backgroundColor: COLORS.scenarioCFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      });
    }

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: prepared.labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animate ? {} : false,
        plugins: {
          legend: { position: 'top', rtl: true, textDirection: 'rtl' },
          tooltip: currencyTooltip(),
        },
        scales: lineScales(),
      },
    });

    storeChart(canvasId, chart);
  }

  /**
   * 3. Cumulative Net Received Chart (Line).
   */
  function createNetChart(canvasId, scenarioAData, scenarioBData, scenarioCData) {
    const ctx = ensureCanvas(canvasId);
    if (!ctx) return;

    const aRaw = scenarioAData.map(function (d) { return d.cumulativeNet; });
    const bRaw = scenarioBData.map(function (d) { return d.cumulativeNet; });
    const cRaw = scenarioCData ? scenarioCData.map(function (d) { return d.cumulativeNet; }) : null;
    const maxPts = 200;
    const prepared = prepareLineData(aRaw, bRaw, cRaw, maxPts);
    const animate = shouldAnimate(Math.max(aRaw.length, bRaw.length, cRaw ? cRaw.length : 0));

    const datasets = [
      {
        label: 'נטו מצטבר – תרחיש א׳',
        data: prepared.a,
        borderColor: COLORS.scenarioA,
        backgroundColor: COLORS.scenarioAFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      },
      {
        label: 'נטו מצטבר – תרחיש ב׳',
        data: prepared.b,
        borderColor: COLORS.scenarioB,
        backgroundColor: COLORS.scenarioBFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      },
    ];

    if (scenarioCData) {
      datasets.push({
        label: 'נטו מצטבר – תרחיש ג׳',
        data: prepared.c,
        borderColor: COLORS.scenarioC,
        backgroundColor: COLORS.scenarioCFill,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
        spanGaps: true,
      });
    }

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: prepared.labels,
        datasets: datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animate ? {} : false,
        plugins: {
          legend: { position: 'top', rtl: true, textDirection: 'rtl' },
          tooltip: currencyTooltip(),
        },
        scales: lineScales(),
      },
    });

    storeChart(canvasId, chart);
  }

  /**
   * 4. Tax Breakdown Chart (Doughnut) – net vs tax per scenario.
   */
  function createBreakdownChart(canvasId, scenarioASummary, scenarioBSummary, scenarioCSummary) {
    const ctx = ensureCanvas(canvasId);
    if (!ctx) return;

    const labels = [
      'נטו – תרחיש א׳',
      'מס – תרחיש א׳',
      'נטו – תרחיש ב׳',
      'מס – תרחיש ב׳',
    ];
    const data = [
      scenarioASummary.totalNetReceived,
      scenarioASummary.totalTax,
      scenarioBSummary.totalNetReceived,
      scenarioBSummary.totalTax,
    ];
    const bgColors = [
      COLORS.scenarioA,
      COLORS.warning,
      COLORS.scenarioB,
      'rgba(245,158,11,0.5)',
    ];

    if (scenarioCSummary) {
      labels.push('נטו – תרחיש ג׳', 'מס – תרחיש ג׳');
      data.push(scenarioCSummary.totalNetReceived, scenarioCSummary.totalTax);
      bgColors.push(COLORS.scenarioC, 'rgba(16,185,129,0.5)');
    }

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: bgColors,
            borderColor: 'rgba(0,0,0,0.3)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            rtl: true,
            textDirection: 'rtl',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle',
            },
          },
          tooltip: {
            rtl: true,
            textDirection: 'rtl',
            callbacks: {
              label: function (ctx) {
                var total = ctx.dataset.data.reduce(function (s, v) { return s + v; }, 0);
                var pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
                return ctx.label + ': ' + fmtCurrency(ctx.parsed) + ' (' + pct + '%)';
              },
            },
          },
        },
        cutout: '55%',
      },
    });

    storeChart(canvasId, chart);
  }

  // ── public surface ──────────────────────────────────────────
  return {
    destroyAll: destroyAll,
    createBalanceChart: createBalanceChart,
    createTaxChart: createTaxChart,
    createNetChart: createNetChart,
    createBreakdownChart: createBreakdownChart,
  };
})();
