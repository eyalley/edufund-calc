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
   * @param {number} num  – Already in percentage form (e.g. 12.3 not 0.123)
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

  function syncInputModeUI() {
    var toggle = byId('inputModeToggle');
    var summaryMode = byId('summaryMode');
    var yearlyMode = byId('yearlyMode');
    var labelSummary = byId('modeSummaryLabel');
    var labelYearly = byId('modeYearlyLabel');
    if (!toggle) return;

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
  }

  function setupInputModeToggle() {
    var toggle = byId('inputModeToggle');
    if (!toggle) return;
    toggle.addEventListener('change', syncInputModeUI);
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

  // Expose for persistence.js to rebuild profit layer rows on restore
  window._createProfitLayerRow = createProfitLayerRow;

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

  function generateYearlyDepositsTable(startYear, withdrawalYear) {
    var tbody = byId('yearlyDepositsBody');
    if (!tbody) return;

    // Save existing user inputs per year
    var existingValues = {};
    tbody.querySelectorAll('.yearly-deposit-amount').forEach(function (input) {
      var yr = parseInt(input.getAttribute('data-year'), 10);
      if (yr && input.value !== '') {
        existingValues[yr] = input.value;
      }
    });

    tbody.innerHTML = '';
    var ceilings = CalculationEngine.getHistoricalCeilings();
    var sYear = startYear || (byId('startYear') ? parseInt(byId('startYear').value, 10) : DEFAULT_START_YEAR) || DEFAULT_START_YEAR;
    var wYear = withdrawalYear || (byId('withdrawalYear') ? parseInt(byId('withdrawalYear').value, 10) : CURRENT_YEAR) || CURRENT_YEAR;
    var endYear = Math.max(CURRENT_YEAR, wYear);

    for (var year = sYear; year <= endYear; year++) {
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
      inputDeposit.placeholder = '0';
      inputDeposit.setAttribute('inputmode', 'numeric');
      inputDeposit.setAttribute('data-year', year);
      if (existingValues[year] !== undefined) {
        inputDeposit.value = existingValues[year];
      }
      tdDeposit.appendChild(inputDeposit);

      // Ceiling (readonly)
      var tdCeiling = document.createElement('td');
      tdCeiling.className = 'ceiling-cell';
      var ceiling = ceilings[year] || 18854.40;
      tdCeiling.textContent = formatCurrency(ceiling);

      // Tax-free % (readonly, auto-calculated)
      var tdTaxFree = document.createElement('td');
      tdTaxFree.className = 'tax-free-cell';
      if (existingValues[year] !== undefined && parseNum(existingValues[year]) > 0) {
        var r = CalculationEngine.splitDepositByCeiling(parseNum(existingValues[year]), year);
        tdTaxFree.textContent = formatPercent(r * 100);
      } else {
        tdTaxFree.textContent = '—';
      }

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

  function setupYearInputListeners() {
    var startYearInput = byId('startYear');
    var withdrawalYearInput = byId('withdrawalYear');

    if (startYearInput) {
      startYearInput.addEventListener('change', function () {
        var startYear = parseInt(startYearInput.value, 10);
        if (isNaN(startYear) || startYear < 1990 || startYear > CURRENT_YEAR) {
          startYear = DEFAULT_START_YEAR;
          startYearInput.value = startYear;
        }
        var wYear = withdrawalYearInput ? parseInt(withdrawalYearInput.value, 10) : CURRENT_YEAR;
        generateYearlyDepositsTable(startYear, wYear);
      });
    }

    if (withdrawalYearInput) {
      withdrawalYearInput.addEventListener('change', function () {
        var wYear = parseInt(withdrawalYearInput.value, 10);
        if (isNaN(wYear) || wYear < CURRENT_YEAR) {
          wYear = CURRENT_YEAR;
          withdrawalYearInput.value = wYear;
        }
        var startYear = startYearInput ? parseInt(startYearInput.value, 10) : DEFAULT_START_YEAR;
        generateYearlyDepositsTable(startYear, wYear);
      });
    }
  }

  /**
   * Read yearly deposits from the DOM (defaults 0 for empty years).
   * @returns {{ year: number, amount: number, taxFreeRatio: number }[]}
   */
  function getYearlyDeposits() {
    var rows = $$('#yearlyDepositsBody .yearly-deposit-row');
    var deposits = [];
    rows.forEach(function (row) {
      var year = parseInt(row.getAttribute('data-year'), 10);
      var input = row.querySelector('.yearly-deposit-amount');
      var amount = parseNum(input.value);
      deposits.push({
        year: year,
        amount: amount,
        taxFreeRatio: amount > 0 ? CalculationEngine.splitDepositByCeiling(amount, year) : 1
      });
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
        renderBreakdownTable(lastResultA.monthlyData, null, 'a');
      } else if (scenario === 'b' && lastResultB) {
        renderBreakdownTable(lastResultB.monthlyData, null, 'b');
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAKDOWN TABLE
  // ══════════════════════════════════════════════════════════════

  /**
   * Find the 1-based month index in Scenario B where cumulative fee savings
   * (Fee A - Fee B) offset the initial exit tax paid in Month 0.
   */
  function findFeeBreakevenMonth() {
    if (!lastResultA || !lastResultB) return null;
    var dataA = lastResultA.monthlyData;
    var dataB = lastResultB.monthlyData;
    if (!dataA || !dataB || dataB.length === 0) return null;

    var exitTax = dataB[0].tax || 0;
    if (exitTax <= 0) return null; // No exit tax to offset

    var cumFeeDiff = 0;
    var len = Math.min(dataA.length, dataB.length);
    for (var i = 1; i < len; i++) {
      var feeA = dataA[i].fee || 0;
      var feeB = dataB[i].fee || 0;
      var feeDiff = feeA - feeB; // Positive when Tool B fee is lower than Tool A
      cumFeeDiff += feeDiff;
      if (cumFeeDiff >= exitTax) {
        return dataB[i].month; // e.g. month number
      }
    }
    return null;
  }

  function renderBreakdownTable(monthlyData, maxRows, scenario) {
    var limit = maxRows || DEFAULT_BREAKDOWN_ROWS;
    var tbody = byId('breakdownBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    var breakevenMonth = (scenario === 'b') ? findFeeBreakevenMonth() : null;

    var count = Math.min(monthlyData.length, limit);
    for (var i = 0; i < count; i++) {
      var d = monthlyData[i];
      var tr = document.createElement('tr');

      var isStartRow = d.month === 0;
      var isBreakeven = (scenario === 'b' && breakevenMonth != null && d.month === breakevenMonth);

      if (isStartRow) {
        tr.style.background = 'rgba(99,102,241,0.08)';
        tr.style.fontWeight = '600';
      } else if (isBreakeven) {
        tr.className = 'fee-breakeven-row';
      }

      var monthLabel = isStartRow ? 'התחלה' : String(d.month);
      var withdrawalLabel = isStartRow ? '—' : formatCurrency(d.withdrawal);
      var feeLabel = isStartRow ? '—' : formatCurrency(d.fee || 0);
      var taxLabel = isStartRow
        ? (d.tax > 0 ? '⚡ ' + formatCurrency(d.tax) + ' (מס יציאה)' : '—')
        : formatCurrency(d.tax);
      var netLabel = isStartRow ? '—' : formatCurrency(d.netReceived);

      var cells = [
        monthLabel,
        withdrawalLabel,
        feeLabel,
        taxLabel,
        netLabel,
        formatCurrency(d.remainingBalance),
        formatCurrency(d.cumulativeTax),
        formatCurrency(d.cumulativeNet),
      ];

      cells.forEach(function (text, colIndex) {
        var td = document.createElement('td');
        if (colIndex === 0 && isBreakeven) {
          // Add breakeven badge to the month column
          var badge = document.createElement('span');
          badge.className = 'breakeven-badge';
          badge.title = 'בחודש זה החיסכון המצטבר בדמי הניהול פיצה במלואו על מס היציאה';
          badge.textContent = '✓ פיצוי מס';
          td.appendChild(document.createTextNode(text + ' '));
          td.appendChild(badge);
        } else {
          td.textContent = text;
        }
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
        renderBreakdownTable(monthlyData, monthlyData.length, scenario);
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

    var diffBreakevenContainer = byId('diffBreakevenContainer');
    if (diffBreakevenContainer) {
      if (diff < 0) {
        // Scenario B is preferred
        var breakevenM = findFeeBreakevenMonth();
        if (breakevenM != null) {
          setTextIfExists('diffBreakeven', breakevenM + ' חודשים');
          diffBreakevenContainer.classList.remove('hidden');
        } else {
          diffBreakevenContainer.classList.add('hidden');
        }
      } else {
        diffBreakevenContainer.classList.add('hidden');
      }
    }

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
    renderBreakdownTable(resultA.monthlyData, null, 'a');

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
    var annualGrowth = parseNum(byId('toolAGrowth') ? byId('toolAGrowth').value : 0);
    var annualFee = parseNum(byId('toolAFee') ? byId('toolAFee').value : 0);
    var monthlyWithdrawal = parseNum(byId('monthlyWithdrawal') ? byId('monthlyWithdrawal').value : 0);
    var inflationRate = parseNum(byId('inflationRate') ? byId('inflationRate').value : 2);
    var withdrawalYear = parseNum(byId('withdrawalYear') ? byId('withdrawalYear').value : CURRENT_YEAR) || CURRENT_YEAR;

    if (withdrawalYear < CURRENT_YEAR) {
      withdrawalYear = CURRENT_YEAR;
      if (byId('withdrawalYear')) byId('withdrawalYear').value = CURRENT_YEAR;
    }

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
      var hasAnyDeposit = yearlyDeposits.some(function (d) { return d.amount > 0; });
      var yearlyTotalBalance = parseNum(byId('yearlyTotalBalance') ? byId('yearlyTotalBalance').value : 0);

      if (yearlyTotalBalance <= 0) {
        showError('yearlyTotalBalance', 'יש להזין יתרה נוכחית');
        valid = false;
      }

      if (!hasAnyDeposit) {
        showError('startYear', 'יש להזין הפקדה שנתית אחת לפחות');
        valid = false;
      } else if (yearlyTotalBalance > 0) {
        // Calculate sum of past deposits (year <= CURRENT_YEAR)
        var totalPastContributions = yearlyDeposits.reduce(function (sum, d) {
          return d.year <= CURRENT_YEAR ? sum + d.amount : sum;
        }, 0);

        if (yearlyTotalBalance < totalPastContributions) {
          showError('yearlyTotalBalance', 'היתרה הנוכחית (' + formatCurrency(yearlyTotalBalance) +
            ') נמוכה מסך ההפקדות עד היום (' + formatCurrency(totalPastContributions) + ')');
          valid = false;
        } else {
          deposits = CalculationEngine.calculateDepositCurrentValues(
            yearlyDeposits,
            annualGrowth,
            annualFee,
            CURRENT_YEAR,
            yearlyTotalBalance
          );
        }
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
        year: CURRENT_YEAR
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
      currentYear: CURRENT_YEAR,
      withdrawalYear: withdrawalYear
    };

    var paramsB = {
      deposits: deposits,
      annualGrowth: annualGrowth,
      annualFee: annualFee,
      monthlyWithdrawal: monthlyWithdrawal,
      inflationRate: inflationRate,
      currentYear: CURRENT_YEAR,
      withdrawalYear: withdrawalYear,
      toolBGrowth: toolBGrowth,
      toolBFee: toolBFee,
      toolBTaxRate: toolBTaxRate
    };

    // ── Run calculations ────────────────────────────────────
    lastResultA = CalculationEngine.calculateScenarioA(paramsA);
    lastResultB = CalculationEngine.calculateScenarioB(paramsB);

    // ── Render ──────────────────────────────────────────────
    renderResults(lastResultA, lastResultB);

    // ── Persist form state so reload restores inputs ────────
    if (typeof PersistenceManager !== 'undefined') {
      PersistenceManager.save();
    }
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
    setupYearInputListeners();
    setupNumberFormatting();
    setupChartTabs();
    setupScenarioTabs();

    // 3. Set default withdrawal year to current year if empty
    var withdrawalYearInput = byId('withdrawalYear');
    if (withdrawalYearInput && !withdrawalYearInput.value) {
      withdrawalYearInput.value = CURRENT_YEAR;
    }

    // 4. Generate yearly deposits table based on default start year and withdrawal year
    var startYearInput = byId('startYear');
    if (startYearInput) {
      startYearInput.value = DEFAULT_START_YEAR;
    }
    var wYear = withdrawalYearInput ? parseInt(withdrawalYearInput.value, 10) : CURRENT_YEAR;
    generateYearlyDepositsTable(DEFAULT_START_YEAR, wYear);

    // 5. Calculate button
    var calcBtn = byId('calculateBtn');
    if (calcBtn) {
      calcBtn.addEventListener('click', function (e) {
        e.preventDefault();
        calculate();
      });
    }

    // 6. Ensure results section starts hidden (HTML has class="hidden")
    // Nothing to do — the class is already in HTML

    // 7. Restore state from previous run (if available in localStorage)
    if (typeof PersistenceManager !== 'undefined') {
      PersistenceManager.restore(function () {
        // Callback runs after scalar fields & mode toggle are restored:
        // Regenerate yearly deposits table with restored startYear and withdrawalYear
        var sYear = startYearInput ? parseInt(startYearInput.value, 10) : DEFAULT_START_YEAR;
        var wy = withdrawalYearInput ? parseInt(withdrawalYearInput.value, 10) : CURRENT_YEAR;
        generateYearlyDepositsTable(sYear, wy);

        // Sync mode view
        syncInputModeUI();
      });
    }

    // Always ensure UI mode matches toggle state on load (whether restored or default)
    syncInputModeUI();

    // 8. Format any restored numeric inputs with thousands separators
    $$('.number-input').forEach(function (el) {
      var raw = parseNum(el.value);
      if (raw) {
        el.value = formatThousands(raw);
      }
    });
  });
})();
