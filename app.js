/* ============================================================
   app.js – Main application logic for Investment Comparison
   Depends on: engine.js (CalculationEngine), charts.js (ChartManager)
   ============================================================ */

(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────
  var CURRENT_YEAR = new Date().getFullYear();
  var DEFAULT_START_YEAR = 2000;
  var DEFAULT_BREAKDOWN_ROWS = 120; // 10 years

  // ── Cached scenario results ─────────────────────────────────
  var lastResultA = null;
  var lastResultB = null;

  // ══════════════════════════════════════════════════════════════
  //  UTILITY FUNCTIONS
  // ══════════════════════════════════════════════════════════════

  /**
   * Format a number as Israeli Shekel currency.
   * @param {number} num
   * @returns {string}
   */
  function formatCurrency(num) {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(num);
  }

  /**
   * Format a number as a percentage string (e.g. "12.3%").
   * @param {number} num – Already in percentage form (e.g. 12.3 not 0.123)
   */
  function formatPercent(num) {
    return num.toFixed(1) + '%';
  }

  /**
   * Convert a month count to a Hebrew years-and-months string.
   * @param {number} months
   * @returns {string}
   */
  function formatMonths(months) {
    if (months === Infinity || months == null) return '∞';
    var years = Math.floor(months / 12);
    var remaining = months % 12;
    var parts = [];
    if (years > 0) parts.push(years + ' שנים');
    if (remaining > 0) parts.push(remaining + ' חודשים');
    if (parts.length === 0) return '0 חודשים';
    return parts.join(' ו-');
  }

  /**
   * Parse a possibly-formatted number string back to a plain number.
   * Strips currency symbols, commas, spaces, etc.
   */
  function parseNum(str) {
    if (typeof str === 'number') return str;
    if (!str) return 0;
    return parseFloat(String(str).replace(/[^\d.\-]/g, '')) || 0;
  }

  /**
   * Format a raw number with thousands separators for display.
   */
  function formatThousands(num) {
    if (isNaN(num) || num === '') return '';
    return new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 }).format(num);
  }

  // ── DOM shortcuts ───────────────────────────────────────────

  function $(selector) {
    return document.querySelector(selector);
  }

  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  function byId(id) {
    return document.getElementById(id);
  }

  // ══════════════════════════════════════════════════════════════
  //  VALIDATION
  // ══════════════════════════════════════════════════════════════

  function showError(elementId, message) {
    var el = byId(elementId);
    if (!el) return;
    el.classList.add('input-error');
    // Create or reuse error message element
    var errId = elementId + '-err';
    var errEl = byId(errId);
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.id = errId;
      errEl.className = 'validation-error';
      el.parentNode.appendChild(errEl);
    }
    errEl.textContent = message;
    errEl.style.display = 'block';
  }

  function clearErrors() {
    $$('.input-error').forEach(function (el) {
      el.classList.remove('input-error');
    });
    $$('.validation-error').forEach(function (el) {
      el.style.display = 'none';
    });
  }

  function scrollToResults() {
    var results = byId('resultsSection');
    if (results) {
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CARD COLLAPSE / EXPAND
  // ══════════════════════════════════════════════════════════════

  /**
   * Toggle a card's collapsed state.
   * @param {string} id – The card prefix (e.g., 'globalParams', 'toolA', 'toolB')
   */
  function toggleCard(id) {
    var card = byId(id + 'Card');
    if (!card) return;
    card.classList.toggle('collapsed');
  }

  // Expose globally for inline onclick handlers
  window.toggleCard = toggleCard;

  // ══════════════════════════════════════════════════════════════
  //  INPUT MODE TOGGLE  (Summary ↔ Yearly)
  // ══════════════════════════════════════════════════════════════

  function setupInputModeToggle() {
    var toggle = byId('inputModeToggle');
    if (!toggle) return;

    toggle.addEventListener('change', function () {
      var summaryMode = byId('summaryMode');
      var yearlyMode = byId('yearlyMode');
      var labelSummary = byId('modeSummaryLabel');
      var labelYearly = byId('modeYearlyLabel');

      if (toggle.checked) {
        // Yearly mode
        if (summaryMode) summaryMode.classList.add('hidden');
        if (yearlyMode) yearlyMode.classList.remove('hidden');
        if (labelSummary) labelSummary.classList.remove('active');
        if (labelYearly) labelYearly.classList.add('active');
      } else {
        // Summary mode
        if (summaryMode) summaryMode.classList.remove('hidden');
        if (yearlyMode) yearlyMode.classList.add('hidden');
        if (labelSummary) labelSummary.classList.add('active');
        if (labelYearly) labelYearly.classList.remove('active');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  PROFIT LAYERS  (Summary Mode)
  // ══════════════════════════════════════════════════════════════

  function createProfitLayerRow(name, amount, taxRate) {
    var tr = document.createElement('tr');
    tr.className = 'profit-layer-row';

    // Name
    var tdName = document.createElement('td');
    var inputName = document.createElement('input');
    inputName.type = 'text';
    inputName.className = 'input-field profit-layer-name';
    inputName.value = name || '';
    inputName.placeholder = 'שם שכבת רווח';
    tdName.appendChild(inputName);

    // Amount
    var tdAmount = document.createElement('td');
    var inputAmount = document.createElement('input');
    inputAmount.type = 'text';
    inputAmount.className = 'input-field profit-layer-amount number-input';
    inputAmount.value = amount != null && amount !== '' ? amount : '';
    inputAmount.placeholder = '₪ סכום';
    inputAmount.setAttribute('inputmode', 'numeric');
    tdAmount.appendChild(inputAmount);

    // Tax Rate
    var tdTax = document.createElement('td');
    var inputTax = document.createElement('input');
    inputTax.type = 'number';
    inputTax.className = 'input-field profit-layer-tax';
    inputTax.value = taxRate != null ? taxRate : 25;
    inputTax.placeholder = '% מס';
    inputTax.min = '0';
    inputTax.max = '100';
    inputTax.step = '0.1';
    tdTax.appendChild(inputTax);

    // Delete button
    var tdDel = document.createElement('td');
    var btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-icon btn-delete-layer';
    btnDel.textContent = '✕';
    btnDel.title = 'מחק שכבה';
    btnDel.addEventListener('click', function () {
      var tbody = byId('profitLayersBody');
      if (tbody && tbody.rows.length > 1) {
        tr.remove();
      }
    });
    tdDel.appendChild(btnDel);

    tr.appendChild(tdName);
    tr.appendChild(tdAmount);
    tr.appendChild(tdTax);
    tr.appendChild(tdDel);

    return tr;
  }

  function addDefaultProfitLayers() {
    var tbody = byId('profitLayersBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    tbody.appendChild(createProfitLayerRow('רווח פטור', '', 0));
    tbody.appendChild(createProfitLayerRow('רווח חייב', '', 25));
  }

  function setupAddProfitLayer() {
    var btn = byId('addProfitLayer');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var tbody = byId('profitLayersBody');
      if (tbody) {
        tbody.appendChild(createProfitLayerRow('', '', 25));
      }
    });
  }

  /**
   * Read all profit layers from the DOM.
   * @returns {{ name: string, amount: number, taxRate: number }[]}
   */
  function getProfitLayers() {
    var rows = $$('#profitLayersBody .profit-layer-row');
    var layers = [];
    rows.forEach(function (row) {
      var name = row.querySelector('.profit-layer-name').value.trim();
      var amount = parseNum(row.querySelector('.profit-layer-amount').value);
      var taxRate = parseFloat(row.querySelector('.profit-layer-tax').value) || 0;
      layers.push({ name: name, amount: amount, taxRate: taxRate });
    });
    return layers;
  }

  // ══════════════════════════════════════════════════════════════
  //  YEARLY DEPOSITS TABLE  (Yearly Mode)
  // ══════════════════════════════════════════════════════════════

  function generateYearlyDepositsTable(startYear) {
    var tbody = byId('yearlyDepositsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    var ceilings = CalculationEngine.getHistoricalCeilings();

    for (var year = startYear; year <= CURRENT_YEAR; year++) {
      var tr = document.createElement('tr');
      tr.className = 'yearly-deposit-row';
      tr.setAttribute('data-year', year);

      // Year (readonly)
      var tdYear = document.createElement('td');
      tdYear.textContent = year;
      tdYear.className = 'year-cell';

      // Annual deposit input
      var tdDeposit = document.createElement('td');
      var inputDeposit = document.createElement('input');
      inputDeposit.type = 'text';
      inputDeposit.className = 'input-field yearly-deposit-amount number-input';
      inputDeposit.placeholder = '₪ הפקדה שנתית';
      inputDeposit.setAttribute('inputmode', 'numeric');
      inputDeposit.setAttribute('data-year', year);
      tdDeposit.appendChild(inputDeposit);

      // Ceiling (readonly)
      var tdCeiling = document.createElement('td');
      tdCeiling.className = 'ceiling-cell';
      var ceiling = ceilings[year];
      tdCeiling.textContent = ceiling != null ? formatCurrency(ceiling) : '—';

      // Tax-free % (readonly, auto-calculated)
      var tdTaxFree = document.createElement('td');
      tdTaxFree.className = 'tax-free-cell';
      tdTaxFree.textContent = '—';

      // Recalculate tax-free % when deposit changes
      (function (inputEl, taxFreeEl, yr) {
        inputEl.addEventListener('input', function () {
          var deposit = parseNum(inputEl.value);
          if (deposit > 0) {
            var ratio = CalculationEngine.splitDepositByCeiling(deposit, yr);
            taxFreeEl.textContent = formatPercent(ratio * 100);
          } else {
            taxFreeEl.textContent = '—';
          }
        });
      })(inputDeposit, tdTaxFree, year);

      tr.appendChild(tdYear);
      tr.appendChild(tdDeposit);
      tr.appendChild(tdCeiling);
      tr.appendChild(tdTaxFree);
      tbody.appendChild(tr);
    }
  }

  function setupStartYearListener() {
    var startYearInput = byId('startYear');
    if (!startYearInput) return;

    startYearInput.addEventListener('change', function () {
      var startYear = parseInt(startYearInput.value, 10);
      if (isNaN(startYear) || startYear < 1990 || startYear > CURRENT_YEAR) {
        startYear = DEFAULT_START_YEAR;
        startYearInput.value = startYear;
      }
      generateYearlyDepositsTable(startYear);
    });
  }

  /**
   * Read yearly deposits from the DOM.
   * @returns {{ year: number, amount: number, taxFreeRatio: number }[]}
   */
  function getYearlyDeposits() {
    var rows = $$('#yearlyDepositsBody .yearly-deposit-row');
    var deposits = [];
    rows.forEach(function (row) {
      var year = parseInt(row.getAttribute('data-year'), 10);
      var input = row.querySelector('.yearly-deposit-amount');
      var amount = parseNum(input.value);
      if (amount > 0) {
        deposits.push({
          year: year,
          amount: amount,
          taxFreeRatio: CalculationEngine.splitDepositByCeiling(amount, year)
        });
      }
    });
    return deposits;
  }

  // ══════════════════════════════════════════════════════════════
  //  NUMBER INPUT FORMATTING
  // ══════════════════════════════════════════════════════════════

  function setupNumberFormatting() {
    document.addEventListener('focusout', function (e) {
      if (e.target && e.target.classList.contains('number-input')) {
        var raw = parseNum(e.target.value);
        if (raw) {
          e.target.value = formatThousands(raw);
        }
      }
    });

    document.addEventListener('focusin', function (e) {
      if (e.target && e.target.classList.contains('number-input')) {
        var raw = parseNum(e.target.value);
        if (raw) {
          e.target.value = raw;
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  CHART TABS
  // ══════════════════════════════════════════════════════════════

  function setupChartTabs() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('.chart-tab');
      if (!tab) return;

      var tabGroup = tab.parentNode;
      // Deactivate siblings
      tabGroup.querySelectorAll('.chart-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      tab.classList.add('active');

      // Show the target canvas, hide others
      var targetChart = tab.getAttribute('data-chart');
      var canvasMap = {
        'balance': 'balanceChart',
        'tax': 'taxChart',
        'net': 'netChart',
        'breakdown': 'breakdownChart'
      };

      Object.keys(canvasMap).forEach(function (key) {
        var canvas = byId(canvasMap[key]);
        if (canvas) {
          if (key === targetChart) {
            canvas.classList.remove('hidden');
            canvas.style.display = '';
          } else {
            canvas.classList.add('hidden');
            canvas.style.display = 'none';
          }
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  SCENARIO TABS (Breakdown Table)
  // ══════════════════════════════════════════════════════════════

  function setupScenarioTabs() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('.scenario-tab');
      if (!tab) return;

      var tabGroup = tab.parentNode;
      tabGroup.querySelectorAll('.scenario-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      tab.classList.add('active');

      var scenario = tab.getAttribute('data-scenario');
      if (scenario === 'a' && lastResultA) {
        renderBreakdownTable(lastResultA.monthlyData);
      } else if (scenario === 'b' && lastResultB) {
        renderBreakdownTable(lastResultB.monthlyData);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAKDOWN TABLE
  // ══════════════════════════════════════════════════════════════

  function renderBreakdownTable(monthlyData, maxRows) {
    var limit = maxRows || DEFAULT_BREAKDOWN_ROWS;
    var tbody = byId('breakdownBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    var count = Math.min(monthlyData.length, limit);
    for (var i = 0; i < count; i++) {
      var d = monthlyData[i];
      var tr = document.createElement('tr');

      var cells = [
        d.month,
        formatCurrency(d.withdrawal),
        formatCurrency(d.tax),
        formatCurrency(d.netReceived),
        formatCurrency(d.remainingBalance),
        formatCurrency(d.cumulativeTax),
        formatCurrency(d.cumulativeNet),
      ];

      cells.forEach(function (text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }

    // Show more button
    var existingBtn = byId('showMoreBreakdown');
    if (existingBtn) existingBtn.remove();

    if (monthlyData.length > limit) {
      var btn = document.createElement('button');
      btn.id = 'showMoreBreakdown';
      btn.type = 'button';
      btn.className = 'btn-secondary show-more-btn';
      btn.textContent = 'הצג עוד (' + (monthlyData.length - limit) + ' שורות נוספות)';
      btn.addEventListener('click', function () {
        renderBreakdownTable(monthlyData, monthlyData.length);
      });
      // Insert after the table-scroll container
      var tableScroll = tbody.closest('.table-scroll');
      if (tableScroll && tableScroll.parentNode) {
        tableScroll.parentNode.appendChild(btn);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  RENDER RESULTS
  // ══════════════════════════════════════════════════════════════

  function renderResults(resultA, resultB) {
    var sa = resultA.summary;
    var sb = resultB.summary;

    // ── Summary cards for Scenario A ────────────────────────
    setTextIfExists('scenarioATax', formatCurrency(sa.totalTax));
    setTextIfExists('scenarioANet', formatCurrency(sa.totalNetReceived));
    setTextIfExists('scenarioAMonths', formatMonths(sa.monthsToExhaustion));
    setTextIfExists('scenarioAEffRate', formatPercent(sa.effectiveTaxRate));

    // ── Summary cards for Scenario B ────────────────────────
    setTextIfExists('scenarioBTax', formatCurrency(sb.totalTax));
    setTextIfExists('scenarioBNet', formatCurrency(sb.totalNetReceived));
    setTextIfExists('scenarioBMonths', formatMonths(sb.monthsToExhaustion));
    setTextIfExists('scenarioBEffRate', formatPercent(sb.effectiveTaxRate));

    // ── Winner badge ────────────────────────────────────────
    var winnerBadge = byId('winnerBadge');
    var diff = sa.totalNetReceived - sb.totalNetReceived;

    if (winnerBadge) {
      if (diff > 0) {
        winnerBadge.textContent = '✦ תרחיש א׳ עדיף – חיסכון של ' + formatCurrency(diff);
        winnerBadge.style.color = '';
        winnerBadge.style.background = '';
        winnerBadge.style.borderColor = '';
      } else if (diff < 0) {
        winnerBadge.textContent = '✦ תרחיש ב׳ עדיף – חיסכון של ' + formatCurrency(Math.abs(diff));
        winnerBadge.style.color = 'var(--accent-b)';
        winnerBadge.style.background = 'rgba(6, 182, 212, 0.15)';
        winnerBadge.style.borderColor = 'rgba(6, 182, 212, 0.3)';
      } else {
        winnerBadge.textContent = '✦ שוויון מושלם!';
      }
    }

    // ── Difference card ─────────────────────────────────────
    setTextIfExists('diffTax', formatCurrency(Math.abs(sa.totalTax - sb.totalTax)));
    setTextIfExists('diffNet', formatCurrency(Math.abs(sa.totalNetReceived - sb.totalNetReceived)));
    setTextIfExists('diffMonths', Math.abs((sa.monthsToExhaustion || 0) - (sb.monthsToExhaustion || 0)) + ' חודשים');

    // ── Charts ──────────────────────────────────────────────
    // Make all canvases visible temporarily for Chart.js to calculate dimensions
    var canvasIds = ['balanceChart', 'taxChart', 'netChart', 'breakdownChart'];
    canvasIds.forEach(function (id) {
      var c = byId(id);
      if (c) {
        c.classList.remove('hidden');
        c.style.display = '';
      }
    });

    ChartManager.destroyAll();
    ChartManager.createBalanceChart('balanceChart', resultA.monthlyData, resultB.monthlyData);
    ChartManager.createTaxChart('taxChart', resultA.monthlyData, resultB.monthlyData);
    ChartManager.createNetChart('netChart', resultA.monthlyData, resultB.monthlyData);
    ChartManager.createBreakdownChart('breakdownChart', sa, sb);

    // Hide non-active canvases (balance is shown by default)
    ['taxChart', 'netChart', 'breakdownChart'].forEach(function (id) {
      var c = byId(id);
      if (c) {
        c.classList.add('hidden');
        c.style.display = 'none';
      }
    });

    // Reset chart tabs to "balance"
    $$('.chart-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-chart') === 'balance');
    });

    // ── Breakdown table (Scenario A by default) ─────────────
    renderBreakdownTable(resultA.monthlyData);

    // Reset scenario tabs to A
    $$('.scenario-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-scenario') === 'a');
    });

    // ── Show results section & scroll ───────────────────────
    var resultsSection = byId('resultsSection');
    if (resultsSection) {
      resultsSection.classList.remove('hidden');
    }
    setTimeout(scrollToResults, 100);
  }

  function setTextIfExists(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
  }

  // ══════════════════════════════════════════════════════════════
  //  CALCULATE
  // ══════════════════════════════════════════════════════════════

  function isYearlyMode() {
    var toggle = byId('inputModeToggle');
    return toggle && toggle.checked;
  }

  function calculate() {
    clearErrors();
    var valid = true;

    // ── Common parameters ───────────────────────────────────
    // NOTE: Engine expects raw percentage values (e.g. 6 for 6%, not 0.06)
    var annualGrowth = parseNum(byId('toolAGrowth') ? byId('toolAGrowth').value : 0);
    var annualFee = parseNum(byId('toolAFee') ? byId('toolAFee').value : 0);
    var monthlyWithdrawal = parseNum(byId('monthlyWithdrawal') ? byId('monthlyWithdrawal').value : 0);
    var inflationRate = parseNum(byId('inflationRate') ? byId('inflationRate').value : 2);

    // Scenario B specific
    var toolBGrowth = parseNum(byId('toolBGrowth') ? byId('toolBGrowth').value : 0);
    var toolBFee = parseNum(byId('toolBFee') ? byId('toolBFee').value : 0);
    var toolBTaxRate = parseNum(byId('toolBTaxRate') ? byId('toolBTaxRate').value : 25);

    // Validate common
    if (monthlyWithdrawal <= 0) {
      showError('monthlyWithdrawal', 'יש להזין סכום משיכה חודשי');
      valid = false;
    }
    if (annualGrowth <= 0) {
      showError('toolAGrowth', 'יש להזין תשואה שנתית');
      valid = false;
    }

    // ── Build deposits ──────────────────────────────────────
    var deposits = [];

    if (isYearlyMode()) {
      // ── Yearly mode ─────────────────────────────────────
      var yearlyDeposits = getYearlyDeposits();
      if (yearlyDeposits.length === 0) {
        showError('startYear', 'יש להזין הפקדה שנתית אחת לפחות');
        valid = false;
      } else {
        // getYearlyDeposits() already returns {year, amount, taxFreeRatio}
        deposits = CalculationEngine.calculateDepositCurrentValues(
          yearlyDeposits,
          annualGrowth,
          annualFee,
          CURRENT_YEAR
        );
      }
    } else {
      // ── Summary mode ────────────────────────────────────
      var totalPrincipal = parseNum(byId('totalPrincipal') ? byId('totalPrincipal').value : 0);
      var totalBalance = parseNum(byId('totalBalance') ? byId('totalBalance').value : 0);

      if (totalPrincipal <= 0) {
        showError('totalPrincipal', 'יש להזין סכום קרן');
        valid = false;
      }
      if (totalBalance <= 0) {
        showError('totalBalance', 'יש להזין יתרה נוכחית');
        valid = false;
      }
      if (totalBalance < totalPrincipal) {
        showError('totalBalance', 'היתרה חייבת להיות גדולה מסה״כ הקרן');
        valid = false;
      }

      // Validate profit layers
      var profitLayers = getProfitLayers();
      var totalProfit = totalBalance - totalPrincipal;

      // Check profit layers sum
      if (totalProfit > 0) {
        var layersSum = profitLayers.reduce(function (s, l) { return s + l.amount; }, 0);
        var tolerance = totalProfit * 0.1; // 10% tolerance
        if (layersSum > 0 && Math.abs(layersSum - totalProfit) > tolerance) {
          showError('profitLayersBody', 'סכום שכבות הרווח (' + formatCurrency(layersSum) +
            ') לא תואם לרווח הכולל (' + formatCurrency(totalProfit) + ')');
          // Warning only — still allow calculation
        }
      }

      // Calculate taxFreeRatio from profit layers
      var taxFreeProfit = profitLayers.filter(function (l) {
        return l.taxRate === 0;
      }).reduce(function (s, l) { return s + l.amount; }, 0);

      var taxFreeRatio = totalProfit > 0 ? taxFreeProfit / totalProfit : 1;

      deposits = [{
        principal: totalPrincipal,
        currentValue: totalBalance,
        taxFreeRatio: taxFreeRatio,
      }];
    }

    if (!valid) return;

    // ── Build params ────────────────────────────────────────
    var paramsA = {
      deposits: deposits,
      annualGrowth: annualGrowth,
      annualFee: annualFee,
      monthlyWithdrawal: monthlyWithdrawal,
      inflationRate: inflationRate,
    };

    var paramsB = {
      deposits: deposits,
      annualGrowth: annualGrowth,
      annualFee: annualFee,
      monthlyWithdrawal: monthlyWithdrawal,
      inflationRate: inflationRate,
      toolBGrowth: toolBGrowth,
      toolBFee: toolBFee,
      toolBTaxRate: toolBTaxRate,
    };

    // ── Run calculations ────────────────────────────────────
    lastResultA = CalculationEngine.calculateScenarioA(paramsA);
    lastResultB = CalculationEngine.calculateScenarioB(paramsB);

    // ── Render ──────────────────────────────────────────────
    renderResults(lastResultA, lastResultB);
  }

  // ══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ══════════════════════════════════════════════════════════════

  document.addEventListener('DOMContentLoaded', function () {
    // 1. Add default profit layers
    addDefaultProfitLayers();

    // 2. Set up event listeners
    setupInputModeToggle();
    setupAddProfitLayer();
    setupStartYearListener();
    setupNumberFormatting();
    setupChartTabs();
    setupScenarioTabs();

    // 3. Generate yearly deposits table based on default start year
    var startYearInput = byId('startYear');
    if (startYearInput) {
      startYearInput.value = DEFAULT_START_YEAR;
    }
    generateYearlyDepositsTable(DEFAULT_START_YEAR);

    // 4. Calculate button
    var calcBtn = byId('calculateBtn');
    if (calcBtn) {
      calcBtn.addEventListener('click', function (e) {
        e.preventDefault();
        calculate();
      });
    }

    // 5. Ensure results section starts hidden (HTML has class="hidden")
    // Nothing to do — the class is already in HTML

    // 6. Set summary mode as default active
    var summaryMode = byId('summaryMode');
    var yearlyMode = byId('yearlyMode');
    if (summaryMode) summaryMode.classList.remove('hidden');
    if (yearlyMode) yearlyMode.classList.add('hidden');
  });
})();
