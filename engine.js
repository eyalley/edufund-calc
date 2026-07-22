/**
 * @file engine.js
 * @description מנוע חישובים טהור להשוואת תרחישי השקעה בישראל.
 * אין קוד DOM, אין UI — חישובים בלבד.
 */

/** @typedef {Object} ProfitLayer
 * @property {string} name - Layer name (e.g., 'רווח פטור')
 * @property {number} amount - Current profit amount in this layer (₪)
 * @property {number} taxRate - Tax rate as percentage (0-100)
 */

/** @typedef {Object} Deposit
 * @property {number} principal - Original invested principal (₪), non-taxable
 * @property {number} currentValue - Current total value of this deposit (₪)
 * @property {number} taxFreeRatio - Ratio of this deposit that is within the tax-free ceiling (0-1)
 */

/** @typedef {Object} CalculationParams
 * @property {Deposit[]} deposits - Deposits in FIFO order (oldest first)
 * @property {number} annualGrowth - Expected annual growth rate (%)
 * @property {number} annualFee - Annual management fee (%)
 * @property {number} monthlyWithdrawal - Base monthly withdrawal (₪)
 * @property {number} inflationRate - Annual inflation rate (%, default 2)
 * @property {number} toolBGrowth - Tool B annual growth rate (%)
 * @property {number} toolBFee - Tool B annual management fee (%)
 * @property {number} toolBTaxRate - Tool B tax rate on profits (%)
 */

/** @typedef {Object} MonthlyDataPoint
 * @property {number} month - Month number (1-based)
 * @property {number} withdrawal - Gross withdrawal amount this month
 * @property {number} tax - Tax paid this month
 * @property {number} netReceived - Net received (withdrawal - tax)
 * @property {number} remainingBalance - Remaining fund balance after withdrawal
 * @property {number} cumulativeTax - Cumulative tax paid so far
 * @property {number} cumulativeNet - Cumulative net received so far
 * @property {number} cumulativeWithdrawal - Cumulative gross withdrawal
 */

/** @typedef {Object} ScenarioSummary
 * @property {number} totalTax - Total tax paid
 * @property {number} totalNetReceived - Total net amount received
 * @property {number} totalWithdrawn - Total gross amount withdrawn
 * @property {number} monthsToExhaustion - Number of months until fund is exhausted
 * @property {number} effectiveTaxRate - Effective tax rate (totalTax / totalWithdrawn * 100)
 */

/** @typedef {Object} ScenarioResult
 * @property {MonthlyDataPoint[]} monthlyData
 * @property {ScenarioSummary} summary
 */

var CalculationEngine = (function () {

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  var MAX_MONTHS = 1200; // 100-year safety cap
  var TAX_RATE_KEREN = 0.25; // 25% tax on taxable portion of קרן השתלמות profits

  /**
   * @description עיגול לשתי ספרות עשרוניות — מונע בעיות floating-point
   * @param {number} x
   * @returns {number}
   */
  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * @description חישוב שיעור צמיחה חודשי מתוך שיעור שנתי
   * @param {number} annualPct - Annual rate as percentage (e.g. 5 for 5%)
   * @returns {number} Monthly multiplier minus 1
   */
  function monthlyGrowthRate(annualPct) {
    return Math.pow(1 + annualPct / 100, 1 / 12) - 1;
  }

  /**
   * @description חישוב מקדם דמי ניהול חודשי מתוך שיעור שנתי
   * @param {number} annualFeePct - Annual fee as percentage (e.g. 0.8 for 0.8%)
   * @returns {number} Monthly fee fraction (e.g. annualFeePct / 100 / 12)
   */
  function monthlyFeeFraction(annualFeePct) {
    return annualFeePct / 100 / 12;
  }

  /**
   * @description חישוב משיכה מותאמת אינפלציה לחודש מסוים
   * @param {number} baseWithdrawal - Base monthly withdrawal (₪)
   * @param {number} month0Based - 0-based month index
   * @param {number} inflationRate - Annual inflation rate (%)
   * @returns {number}
   */
  function inflationAdjustedWithdrawal(baseWithdrawal, month0Based, inflationRate) {
    return baseWithdrawal * Math.pow(1 + inflationRate / 100, month0Based / 12);
  }

  /**
   * @description יצירת עותק עמוק של מערך הפקדות כדי לא לשנות את הקלט המקורי
   * @param {Deposit[]} deposits
   * @returns {Deposit[]}
   */
  function cloneDeposits(deposits) {
    return deposits.map(function (d) {
      return {
        principal: d.principal,
        currentValue: d.currentValue,
        taxFreeRatio: d.taxFreeRatio
      };
    });
  }

  /**
   * @description חישוב סכום ערך נוכחי של כל ההפקדות
   * @param {Deposit[]} deposits
   * @returns {number}
   */
  function totalCurrentValue(deposits) {
    var sum = 0;
    for (var i = 0; i < deposits.length; i++) {
      sum += deposits[i].currentValue;
    }
    return sum;
  }

  // ---------------------------------------------------------------------------
  // Historical ceiling data
  // ---------------------------------------------------------------------------

  /**
   * @description מחזיר את תקרות ההפקדה הפטורות ממס לפי שנה
   * @returns {Object.<number, number>} Map of year → max annual tax-free deposit
   */
  function getHistoricalCeilings() {
    var ceilings = {};
    var year;

    // 1995–2003: monthly salary ceiling ₪14,500
    for (year = 1995; year <= 2003; year++) {
      ceilings[year] = 14500 * 12 * 0.10; // ₪17,400
    }

    // 2004–2030: monthly salary ceiling ₪15,712
    for (year = 2004; year <= 2030; year++) {
      ceilings[year] = 15712 * 12 * 0.10; // ₪18,854.40
    }

    return ceilings;
  }

  /**
   * @description מפצל הפקדה שנתית לחלק פטור וחלק חייב לפי תקרת השנה
   * @param {number} annualDeposit - Total annual deposit (₪)
   * @param {number} year - The deposit year
   * @returns {number} taxFreeRatio (0-1)
   */
  function splitDepositByCeiling(annualDeposit, year) {
    var ceilings = getHistoricalCeilings();
    var maxTaxFree = ceilings[year] || 18854.40;
    var taxFreeAmount = Math.min(annualDeposit, maxTaxFree);
    var taxFreeRatio = annualDeposit > 0 ? taxFreeAmount / annualDeposit : 1;
    return taxFreeRatio;
  }

  // ---------------------------------------------------------------------------
  // Helper: calculateDepositCurrentValues
  // ---------------------------------------------------------------------------

  /**
   * @description מחשב ערך נוכחי של הפקדות שנתיות לפי צמיחה ודמי ניהול חודשיים
   * @param {Array<{year: number, amount: number, taxFreeRatio: number}>} yearlyDeposits
   * @param {number} annualGrowth - Annual growth rate (%)
   * @param {number} annualFee - Annual management fee (%)
   * @param {number} currentYear - The current year for elapsed-time calculation
   * @returns {Deposit[]}
   */
  function calculateDepositCurrentValues(yearlyDeposits, annualGrowth, annualFee, currentYear) {
    var mgr = monthlyGrowthRate(annualGrowth);
    var mfr = monthlyFeeFraction(annualFee);

    return yearlyDeposits.map(function (d) {
      var years = currentYear - d.year;
      var months = years * 12;
      var value = d.amount;

      for (var m = 0; m < months; m++) {
        value *= (1 + mgr);
        value *= (1 - mfr);
      }

      return {
        principal: d.amount,
        currentValue: round2(value),
        taxFreeRatio: d.taxFreeRatio
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Scenario A — Gradual monthly withdrawal from קרן השתלמות
  // ---------------------------------------------------------------------------

  /**
   * @description תרחיש א׳ — משיכה הדרגתית חודשית מקרן השתלמות עם חישוב מס FIFO
   * @param {CalculationParams} params
   * @returns {ScenarioResult}
   */
  function calculateScenarioA(params) {
    var deposits = cloneDeposits(params.deposits);
    var annualGrowth = params.annualGrowth;
    var annualFee = params.annualFee;
    var baseWithdrawal = params.monthlyWithdrawal;
    var inflationRate = (params.inflationRate != null) ? params.inflationRate : 2;

    var mgr = monthlyGrowthRate(annualGrowth);
    var mfr = monthlyFeeFraction(annualFee);

    var monthlyData = [];
    var cumulativeTax = 0;
    var cumulativeNet = 0;
    var cumulativeWithdrawal = 0;
    var month = 0; // 0-based internally

    // Edge case: no deposits or zero withdrawal
    if (deposits.length === 0 || baseWithdrawal <= 0) {
      return {
        monthlyData: [],
        summary: {
          totalTax: 0,
          totalNetReceived: 0,
          totalWithdrawn: 0,
          monthsToExhaustion: 0,
          effectiveTaxRate: 0
        }
      };
    }

    while (deposits.length > 0 && month < MAX_MONTHS) {

      // --- Step 1: GROW each deposit ---
      for (var i = 0; i < deposits.length; i++) {
        deposits[i].currentValue *= (1 + mgr);
        // principal stays the same; profit = currentValue - principal
      }

      // --- Step 2: MANAGEMENT FEE on each deposit ---
      for (var i = 0; i < deposits.length; i++) {
        deposits[i].currentValue *= (1 - mfr);
        // principal stays the same
      }

      // --- Step 3: WITHDRAW (FIFO) ---
      var adjustedWithdrawal = inflationAdjustedWithdrawal(baseWithdrawal, month, inflationRate);
      var remaining = adjustedWithdrawal;
      var monthTax = 0;

      while (remaining > 0.001 && deposits.length > 0) {
        var dep = deposits[0];
        var withdrawFromThis = Math.min(remaining, dep.currentValue);

        if (dep.currentValue > dep.principal) {
          // There IS profit
          var profitRatio = (dep.currentValue - dep.principal) / dep.currentValue;
          var profitPortion = withdrawFromThis * profitRatio;
          var taxFreeProfit = profitPortion * dep.taxFreeRatio;
          var taxableProfit = profitPortion * (1 - dep.taxFreeRatio);
          var tax = taxableProfit * TAX_RATE_KEREN;
          monthTax += tax;

          var principalWithdrawn = withdrawFromThis - profitPortion;
          dep.principal -= principalWithdrawn;
          dep.currentValue -= withdrawFromThis;
        } else {
          // No profit or negative profit — all withdrawal is from principal
          dep.principal -= withdrawFromThis;
          dep.currentValue -= withdrawFromThis;
          // no tax
        }

        // Remove exhausted deposit
        if (dep.currentValue <= 0.01) {
          deposits.shift();
        }

        remaining -= withdrawFromThis;
      }

      // Actual withdrawal may be less than requested if deposits ran out
      var actualWithdrawal = adjustedWithdrawal - Math.max(0, remaining);
      monthTax = round2(monthTax);
      var netReceived = round2(actualWithdrawal - monthTax);

      cumulativeTax += monthTax;
      cumulativeNet += netReceived;
      cumulativeWithdrawal += actualWithdrawal;

      var remainingBalance = round2(totalCurrentValue(deposits));

      // --- Step 4: Record data point (1-based month) ---
      monthlyData.push({
        month: month + 1,
        withdrawal: round2(actualWithdrawal),
        tax: monthTax,
        netReceived: netReceived,
        remainingBalance: remainingBalance,
        cumulativeTax: round2(cumulativeTax),
        cumulativeNet: round2(cumulativeNet),
        cumulativeWithdrawal: round2(cumulativeWithdrawal)
      });

      month++;
    }

    var totalWithdrawn = round2(cumulativeWithdrawal);

    return {
      monthlyData: monthlyData,
      summary: {
        totalTax: round2(cumulativeTax),
        totalNetReceived: round2(cumulativeNet),
        totalWithdrawn: totalWithdrawn,
        monthsToExhaustion: month,
        effectiveTaxRate: totalWithdrawn > 0
          ? round2(cumulativeTax / totalWithdrawn * 100)
          : 0
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Scenario B — Lump sum withdrawal from Tool A + reinvest in Tool B
  // ---------------------------------------------------------------------------

  /**
   * @description תרחיש ב׳ — משיכה חד-פעמית מכלי א׳, השקעה מחדש בכלי ב׳ ומשיכה חודשית
   * @param {CalculationParams} params
   * @returns {ScenarioResult}
   */
  function calculateScenarioB(params) {
    var deposits = params.deposits;
    var baseWithdrawal = params.monthlyWithdrawal;
    var inflationRate = (params.inflationRate != null) ? params.inflationRate : 2;
    var toolBGrowth = params.toolBGrowth;
    var toolBFee = params.toolBFee;
    var toolBTaxRate = params.toolBTaxRate;

    // Edge case: no deposits or zero withdrawal
    if (!deposits || deposits.length === 0 || baseWithdrawal <= 0) {
      return {
        monthlyData: [],
        summary: {
          totalTax: 0,
          totalNetReceived: 0,
          totalWithdrawn: 0,
          monthsToExhaustion: 0,
          effectiveTaxRate: 0
        }
      };
    }

    // --- Step 1: Calculate lump sum tax from Tool A ---
    var totalValue = 0;
    var totalTaxOnA = 0;

    for (var i = 0; i < deposits.length; i++) {
      var dep = deposits[i];
      totalValue += dep.currentValue;
      var profit = Math.max(0, dep.currentValue - dep.principal);
      var taxableProfit = profit * (1 - dep.taxFreeRatio);
      totalTaxOnA += taxableProfit * TAX_RATE_KEREN;
    }

    totalTaxOnA = round2(totalTaxOnA);
    var netProceeds = round2(totalValue - totalTaxOnA);

    // --- Step 2: Monthly withdrawal from Tool B ---
    var principal = netProceeds;
    var currentValue = netProceeds;
    var month = 0;
    var cumulativeTax = totalTaxOnA; // Start with tax already paid from Tool A
    var cumulativeNet = 0;
    var cumulativeWithdrawal = 0;

    var mgr = monthlyGrowthRate(toolBGrowth);
    var mfr = monthlyFeeFraction(toolBFee);

    var monthlyData = [];

    while (currentValue > 0.01 && month < MAX_MONTHS) {

      // --- Grow ---
      currentValue *= (1 + mgr);

      // --- Fee ---
      currentValue *= (1 - mfr);

      // --- Withdraw ---
      var adjustedWithdrawal = inflationAdjustedWithdrawal(baseWithdrawal, month, inflationRate);
      var withdrawal = Math.min(adjustedWithdrawal, currentValue);
      var monthTax = 0;

      if (currentValue > principal) {
        // There is profit in Tool B
        var profitRatio = (currentValue - principal) / currentValue;
        var profitPortion = withdrawal * profitRatio;
        monthTax = profitPortion * (toolBTaxRate / 100);
        principal -= withdrawal * (1 - profitRatio);
      } else {
        // No profit — all withdrawal from principal
        monthTax = 0;
        principal -= withdrawal;
      }

      currentValue -= withdrawal;

      // Clamp to avoid tiny negatives from floating point
      if (currentValue < 0) {
        currentValue = 0;
      }
      if (principal < 0) {
        principal = 0;
      }

      monthTax = round2(monthTax);
      var netReceived = round2(withdrawal - monthTax);
      cumulativeTax += monthTax;
      cumulativeNet += netReceived;
      cumulativeWithdrawal += withdrawal;

      monthlyData.push({
        month: month + 1,
        withdrawal: round2(withdrawal),
        tax: monthTax,
        netReceived: netReceived,
        remainingBalance: round2(currentValue),
        cumulativeTax: round2(cumulativeTax),
        cumulativeNet: round2(cumulativeNet),
        cumulativeWithdrawal: round2(cumulativeWithdrawal)
      });

      month++;
    }

    var totalWithdrawn = round2(cumulativeWithdrawal);

    return {
      monthlyData: monthlyData,
      summary: {
        totalTax: round2(cumulativeTax),
        totalNetReceived: round2(cumulativeNet),
        totalWithdrawn: totalWithdrawn,
        monthsToExhaustion: month,
        effectiveTaxRate: totalWithdrawn > 0
          ? round2(cumulativeTax / totalWithdrawn * 100)
          : 0
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    calculateScenarioA: calculateScenarioA,
    calculateScenarioB: calculateScenarioB,
    calculateDepositCurrentValues: calculateDepositCurrentValues,
    splitDepositByCeiling: splitDepositByCeiling,
    getHistoricalCeilings: getHistoricalCeilings
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalculationEngine;
}
if (typeof window !== 'undefined') {
  window.CalculationEngine = CalculationEngine;
}
