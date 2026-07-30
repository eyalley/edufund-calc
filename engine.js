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
 * @property {number} [year] - Year of deposit (optional)
 */

/** @typedef {Object} CalculationParams
 * @property {Deposit[]} deposits - Deposits in FIFO order (oldest first)
 * @property {number} annualGrowth - Expected annual growth rate (%)
 * @property {number} annualFee - Annual management fee (%)
 * @property {number} monthlyWithdrawal - Base monthly withdrawal (₪)
 * @property {number} [inflationRate=2] - Annual inflation rate (%)
 * @property {number} [currentYear=2026] - Simulation start year
 * @property {number} [withdrawalYear=2026] - Year to start monthly withdrawals
 * @property {number} toolBGrowth - Tool B annual growth rate (%)
 * @property {number} toolBFee - Tool B annual management fee (%)
 * @property {number} toolBTaxRate - Tool B tax rate on profits (%)
 */

/** @typedef {Object} MonthlyDataPoint
 * @property {number} month - Month number (1-based from simulation start)
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
 * @property {number} monthsToExhaustion - Total simulation duration in months
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
   * @description חישוב משיכה מותאמת אינפלציה לחודש מסוים (אינדקס מחודש תחילת סימולציה)
   * @param {number} baseWithdrawal - Base monthly withdrawal (₪)
   * @param {number} month0Based - 0-based month index from simulation start
   * @param {number} inflationRate - Annual inflation rate (%)
   * @returns {number}
   */
  function inflationAdjustedWithdrawal(baseWithdrawal, month0Based, inflationRate) {
    return baseWithdrawal * Math.pow(1 + inflationRate / 100, month0Based / 12);
  }

  /**
   * @description יצירת עותק עמוק של מערך הפקדות
   * @param {Deposit[]} deposits
   * @returns {Deposit[]}
   */
  function cloneDeposits(deposits) {
    return deposits.map(function (d) {
      return {
        principal: d.principal,
        currentValue: d.currentValue,
        taxFreeRatio: d.taxFreeRatio,
        year: d.year
      };
    });
  }

  /**
   * @description חישוב סכום ערך נוכחי של כל ההפקדות הפעילות
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

    // 2004–2060: monthly salary ceiling ₪15,712
    for (year = 2004; year <= 2060; year++) {
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

  /**
   * @description מציאת שיעור תשואה שנתי היסטורי משוקלל בזמן (CAGR) המשערך את הפקדות העבר ליתרה הנוכחית בדיוק
   * @param {Array<{year: number, amount: number, taxFreeRatio: number}>} pastDeposits
   * @param {number} currentBalanceToday
   * @param {number} currentYear
   */
  function solveHistoricalCAGR(pastDeposits, currentBalanceToday, currentYear) {
    var totalPast = 0;
    var hasPositiveHoldingTime = false;
    for (var i = 0; i < pastDeposits.length; i++) {
      totalPast += pastDeposits[i].amount;
      if (currentYear > pastDeposits[i].year) {
        hasPositiveHoldingTime = true;
      }
    }

    if (Math.abs(totalPast - currentBalanceToday) < 0.01 || !hasPositiveHoldingTime) {
      var scale = totalPast > 0 ? currentBalanceToday / totalPast : 1;
      return {
        getVal: function (dep) { return dep.amount * scale; },
        cagr: 0
      };
    }

    var low = 0;
    var high = 100;
    var mid = 0;

    for (var iter = 0; iter < 60; iter++) {
      mid = (low + high) / 2;
      var sumVal = 0;
      for (var j = 0; j < pastDeposits.length; j++) {
        var yrs = currentYear - pastDeposits[j].year;
        sumVal += pastDeposits[j].amount * Math.pow(1 + mid, yrs);
      }
      if (sumVal < currentBalanceToday) {
        low = mid;
      } else {
        high = mid;
      }
    }

    var finalR = (low + high) / 2;
    return {
      getVal: function (dep) {
        var yrs = currentYear - dep.year;
        return dep.amount * Math.pow(1 + finalR, yrs);
      },
      cagr: finalR
    };
  }

  // ---------------------------------------------------------------------------
  // Helper: calculateDepositCurrentValues
  // ---------------------------------------------------------------------------

  /**
   * @description מחשב ערך נוכחי של הפקדות שנתיות. במידה וניתנה יתרה נוכחית להיום (currentBalanceToday), מחושבת תשואה היסטורית משוקללת (Option B - CAGR).
   * @param {Array<{year: number, amount: number, taxFreeRatio: number}>} yearlyDeposits
   * @param {number} annualGrowth - Expected future annual growth rate (%)
   * @param {number} annualFee - Annual management fee (%)
   * @param {number} currentYear - The current year for elapsed-time calculation
   * @param {number} [currentBalanceToday] - Current total balance of fund today (optional)
   * @returns {Deposit[]}
   */
  function calculateDepositCurrentValues(yearlyDeposits, annualGrowth, annualFee, currentYear, currentBalanceToday) {
    if (currentBalanceToday != null && currentBalanceToday > 0) {
      var pastDeposits = yearlyDeposits.filter(function (d) {
        return d.year <= currentYear && d.amount > 0;
      });

      var solverResult = solveHistoricalCAGR(pastDeposits, currentBalanceToday, currentYear);

      return yearlyDeposits.map(function (d) {
        if (d.year > currentYear) {
          return {
            principal: d.amount,
            currentValue: 0,
            taxFreeRatio: d.taxFreeRatio,
            year: d.year
          };
        }

        var val = d.amount > 0 ? solverResult.getVal(d) : 0;
        return {
          principal: d.amount,
          currentValue: round2(val),
          taxFreeRatio: d.taxFreeRatio,
          year: d.year
        };
      });
    }

    var mgr = monthlyGrowthRate(annualGrowth);
    var mfr = monthlyFeeFraction(annualFee);

    return yearlyDeposits.map(function (d) {
      if (d.year > currentYear) {
        return {
          principal: d.amount,
          currentValue: 0,
          taxFreeRatio: d.taxFreeRatio,
          year: d.year
        };
      }

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
        taxFreeRatio: d.taxFreeRatio,
        year: d.year
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
    var allDeposits = cloneDeposits(params.deposits);
    var annualGrowth = params.annualGrowth;
    var annualFee = params.annualFee;
    var baseWithdrawal = params.monthlyWithdrawal;
    var inflationRate = (params.inflationRate != null) ? params.inflationRate : 2;
    var currentYear = params.currentYear || 2026;
    var withdrawalYear = params.withdrawalYear || currentYear;
    var growthMonths = Math.max(0, (withdrawalYear - currentYear) * 12);

    var mgr = monthlyGrowthRate(annualGrowth);
    var mfr = monthlyFeeFraction(annualFee);

    // Split deposits into active (up to currentYear) and pending (future)
    var activeDeposits = [];
    var pendingDeposits = [];

    for (var dIdx = 0; dIdx < allDeposits.length; dIdx++) {
      var dep = allDeposits[dIdx];
      if (!dep.year || dep.year <= currentYear) {
        activeDeposits.push(dep);
      } else {
        pendingDeposits.push(dep);
      }
    }

    var monthlyData = [];
    var cumulativeTax = 0;
    var cumulativeNet = 0;
    var cumulativeWithdrawal = 0;
    var month = 0; // 0-based internally

    // Edge case: no deposits or zero withdrawal
    if ((activeDeposits.length === 0 && pendingDeposits.length === 0) || baseWithdrawal <= 0) {
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

    // Push Month 0 (Starting point today before month 1 growth)
    var initialBalanceA = round2(totalCurrentValue(activeDeposits));
    monthlyData.push({
      month: 0,
      withdrawal: 0,
      tax: 0,
      netReceived: 0,
      remainingBalance: initialBalanceA,
      cumulativeTax: 0,
      cumulativeNet: 0,
      cumulativeWithdrawal: 0
    });

    while ((activeDeposits.length > 0 || pendingDeposits.length > 0) && month < MAX_MONTHS) {

      var simYear = currentYear + Math.floor(month / 12);
      var simMonthInYear = month % 12;

      // --- Add future planned deposits if any for this month/year ---
      if (simMonthInYear === 0 && pendingDeposits.length > 0) {
        for (var pIdx = pendingDeposits.length - 1; pIdx >= 0; pIdx--) {
          if (pendingDeposits[pIdx].year === simYear) {
            var newDep = pendingDeposits.splice(pIdx, 1)[0];
            newDep.currentValue = newDep.principal;
            activeDeposits.push(newDep);
          }
        }
      }

      // --- Step 1: GROW each active deposit ---
      for (var i = 0; i < activeDeposits.length; i++) {
        activeDeposits[i].currentValue *= (1 + mgr);
      }

      // --- Step 2: MANAGEMENT FEE on each active deposit ---
      for (var i = 0; i < activeDeposits.length; i++) {
        activeDeposits[i].currentValue *= (1 - mfr);
      }

      // --- Step 3: WITHDRAWAL ---
      var isWithdrawalPhase = month >= growthMonths;
      var actualWithdrawal = 0;
      var monthTax = 0;
      var netReceived = 0;

      if (isWithdrawalPhase && activeDeposits.length > 0) {
        var adjustedWithdrawal = inflationAdjustedWithdrawal(baseWithdrawal, month, inflationRate);
        var remaining = adjustedWithdrawal;

        while (remaining > 0.001 && activeDeposits.length > 0) {
          var dep = activeDeposits[0];
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
          }

          // Remove exhausted deposit
          if (dep.currentValue <= 0.01) {
            activeDeposits.shift();
          }

          remaining -= withdrawFromThis;
        }

        actualWithdrawal = adjustedWithdrawal - Math.max(0, remaining);
        monthTax = round2(monthTax);
        netReceived = round2(actualWithdrawal - monthTax);

        cumulativeTax += monthTax;
        cumulativeNet += netReceived;
        cumulativeWithdrawal += actualWithdrawal;
      }

      var remainingBalance = round2(totalCurrentValue(activeDeposits));

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
   * @description תרחיש ב׳ — משיכה חד-פעמית מכלי א׳ כיום, השקעה מחדש בכלי ב׳ ומשיכה חודשית
   * @param {CalculationParams} params
   * @returns {ScenarioResult}
   */
  function calculateScenarioB(params) {
    var allDeposits = cloneDeposits(params.deposits);
    var baseWithdrawal = params.monthlyWithdrawal;
    var inflationRate = (params.inflationRate != null) ? params.inflationRate : 2;
    var currentYear = params.currentYear || 2026;
    var withdrawalYear = params.withdrawalYear || currentYear;
    var growthMonths = Math.max(0, (withdrawalYear - currentYear) * 12);
    var toolBGrowth = params.toolBGrowth;
    var toolBFee = params.toolBFee;
    var toolBTaxRate = params.toolBTaxRate;

    // Edge case: no deposits or zero withdrawal
    if (!allDeposits || allDeposits.length === 0 || baseWithdrawal <= 0) {
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

    // --- Step 1: Calculate lump sum tax from Tool A today (currentYear) ---
    var totalValueToday = 0;
    var totalTaxOnA = 0;
    var pendingFutureDeposits = [];

    for (var i = 0; i < allDeposits.length; i++) {
      var dep = allDeposits[i];
      if (!dep.year || dep.year <= currentYear) {
        totalValueToday += dep.currentValue;
        var profit = Math.max(0, dep.currentValue - dep.principal);
        var taxableProfit = profit * (1 - dep.taxFreeRatio);
        totalTaxOnA += taxableProfit * TAX_RATE_KEREN;
      } else {
        pendingFutureDeposits.push(dep);
      }
    }

    totalTaxOnA = round2(totalTaxOnA);
    var netProceeds = round2(totalValueToday - totalTaxOnA);

    // --- Step 2: Monthly simulation in Tool B ---
    var principal = netProceeds;
    var currentValue = netProceeds;
    var month = 0;
    var cumulativeTax = totalTaxOnA; // Start with tax already paid from Tool A
    var cumulativeNet = 0;
    var cumulativeWithdrawal = 0;

    var mgr = monthlyGrowthRate(toolBGrowth);
    var mfr = monthlyFeeFraction(toolBFee);

    var monthlyData = [];

    // Push Month 0 (Starting point today after Tool A exit tax, before month 1 growth)
    var initialBalanceB = netProceeds;
    monthlyData.push({
      month: 0,
      withdrawal: 0,
      tax: totalTaxOnA,
      netReceived: 0,
      remainingBalance: initialBalanceB,
      cumulativeTax: totalTaxOnA,
      cumulativeNet: 0,
      cumulativeWithdrawal: 0
    });

    while ((currentValue > 0.01 || pendingFutureDeposits.length > 0) && month < MAX_MONTHS) {

      var simYear = currentYear + Math.floor(month / 12);
      var simMonthInYear = month % 12;

      // Add future planned deposits directly into Tool B as new principal
      if (simMonthInYear === 0 && pendingFutureDeposits.length > 0) {
        for (var pIdx = pendingFutureDeposits.length - 1; pIdx >= 0; pIdx--) {
          if (pendingFutureDeposits[pIdx].year === simYear) {
            var newDep = pendingFutureDeposits.splice(pIdx, 1)[0];
            currentValue += newDep.principal;
            principal += newDep.principal;
          }
        }
      }

      // --- Grow ---
      currentValue *= (1 + mgr);

      // --- Fee ---
      currentValue *= (1 - mfr);

      // --- Withdraw ---
      var isWithdrawalPhase = month >= growthMonths;
      var withdrawal = 0;
      var monthTax = 0;
      var netReceived = 0;

      if (isWithdrawalPhase && currentValue > 0) {
        var adjustedWithdrawal = inflationAdjustedWithdrawal(baseWithdrawal, month, inflationRate);
        withdrawal = Math.min(adjustedWithdrawal, currentValue);

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

        // Clamp to avoid tiny negatives
        if (currentValue < 0) currentValue = 0;
        if (principal < 0) principal = 0;

        monthTax = round2(monthTax);
        netReceived = round2(withdrawal - monthTax);
        cumulativeTax += monthTax;
        cumulativeNet += netReceived;
        cumulativeWithdrawal += withdrawal;
      }

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
