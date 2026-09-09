/* ============================================================
   persistence.js - Save / restore form state via localStorage
   Depends on: nothing (pure DOM + localStorage)
   Called by:  app.js after DOMContentLoaded
   ============================================================ */

var PersistenceManager = (function () {
  'use strict';

  var STORAGE_KEY = 'finance_calc_state_v1';

  // -- Scalar field IDs that are simple input values ----------
  var SCALAR_FIELDS = [
    // Global & Tool A
    'toolAGrowth', 'toolAFee', 'monthlyWithdrawal',
    'inflationRate', 'withdrawalYear',
    // Tool B
    'toolBGrowth', 'toolBFee', 'toolBTaxRate',
    // Summary mode
    'totalPrincipal', 'totalBalance',
    // Yearly mode
    'startYear', 'yearlyTotalBalance',
  ];

  // -- Helpers ------------------------------------------------

  function byId(id) { return document.getElementById(id); }

  function safeGet(id) {
    var el = byId(id);
    return el ? el.value : '';
  }

  function safeSet(id, val) {
    var el = byId(id);
    if (el && val != null) el.value = val;
  }

  // -- Save ---------------------------------------------------

  /**
   * Capture the entire form state and write it to localStorage.
   * Call this after every successful calculation.
   */
  function save() {
    try {
      var state = {};

      // 1. Input mode toggle
      var toggle = byId('inputModeToggle');
      state.inputMode = toggle ? toggle.checked : false;

      // 2. Scalar fields
      state.fields = {};
      SCALAR_FIELDS.forEach(function (id) {
        state.fields[id] = safeGet(id);
      });

      // 3. Profit layers (summary mode)
      var layers = [];
      var layerRows = document.querySelectorAll('#profitLayersBody .profit-layer-row');
      layerRows.forEach(function (row) {
        var nameEl   = row.querySelector('.profit-layer-name');
        var amountEl = row.querySelector('.profit-layer-amount');
        var taxEl    = row.querySelector('.profit-layer-tax');
        layers.push({
          name:    nameEl   ? nameEl.value   : '',
          amount:  amountEl ? amountEl.value : '',
          taxRate: taxEl    ? taxEl.value    : '25',
        });
      });
      state.profitLayers = layers;

      // 4. Yearly deposit amounts (keyed by year)
      var yearlyAmounts = {};
      var yearlyRows = document.querySelectorAll('#yearlyDepositsBody .yearly-deposit-row');
      yearlyRows.forEach(function (row) {
        var year  = row.getAttribute('data-year');
        var input = row.querySelector('.yearly-deposit-amount');
        if (year && input && input.value !== '') {
          yearlyAmounts[year] = input.value;
        }
      });
      state.yearlyAmounts = yearlyAmounts;

      // 5. Timestamp
      state.savedAt = Date.now();

      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage may be unavailable (private browsing, quota) - fail silently
    }
  }

  // -- Restore ------------------------------------------------

  /**
   * Read state from localStorage and populate the form.
   * @param {function} [onModeChange] - Callback after scalars & mode are restored,
   *   so caller can regenerate the yearly deposits table with the saved startYear.
   * @returns {boolean} true if state was found and applied, false otherwise.
   */
  function restore(onModeChange) {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      var state = JSON.parse(raw);
      if (!state) return false;

      // 1. Scalar fields first (so startYear / withdrawalYear are set before table rebuild)
      if (state.fields) {
        SCALAR_FIELDS.forEach(function (id) {
          if (state.fields[id] != null) {
            safeSet(id, state.fields[id]);
          }
        });
      }

      // 2. Input mode toggle
      var toggle = byId('inputModeToggle');
      if (toggle && state.inputMode != null) {
        toggle.checked = !!state.inputMode;
      }

      // 3. Notify caller so it can rebuild tables with correct year range and sync mode
      if (typeof onModeChange === 'function') {
        onModeChange(state);
      }

      // 4. Profit layers - rebuild table via globally-exposed helper from app.js
      if (state.profitLayers && state.profitLayers.length > 0) {
        var tbody = byId('profitLayersBody');
        if (tbody && typeof window._createProfitLayerRow === 'function') {
          tbody.innerHTML = '';
          state.profitLayers.forEach(function (layer) {
            tbody.appendChild(window._createProfitLayerRow(
              layer.name,
              layer.amount,
              parseFloat(layer.taxRate) || 0
            ));
          });
        }
      }

      // 5. Yearly deposit amounts - fill inputs in the newly built table and trigger input event
      if (state.yearlyAmounts) {
        Object.keys(state.yearlyAmounts).forEach(function (year) {
          var input = document.querySelector(
            '#yearlyDepositsBody .yearly-deposit-amount[data-year="' + year + '"]'
          );
          if (input) {
            input.value = state.yearlyAmounts[year];
            // Trigger input event so the taxFreeRatio cell updates immediately
            try {
              input.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (err) {
              // fallback
            }
          }
        });
      }

      return true;
    } catch (e) {
      return false;
    }
  }

  // -- Clear --------------------------------------------------

  /** Remove saved state (e.g. after a user-initiated reset). */
  function clear() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  // -- Public API ---------------------------------------------

  return { save: save, restore: restore, clear: clear };

})();
