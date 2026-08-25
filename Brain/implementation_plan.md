# מחשבון השוואת השקעות — Implementation Plan: Year to Start Withdrawals & Growth Phase

## Background

Enhance the investment comparison calculator to support a **"שנת תחילת משיכות" (Year to start Withdrawals)** parameter for both Summary Mode and Yearly Deposits Mode.

When the user specifies a withdrawal year in the future (e.g., 2030 when current year is 2026):
1. **Accumulation / Growth Phase**: Both tools grow from today (2026) until the withdrawal year (2030) without withdrawals.
2. **Future Planned Deposits**: In Yearly Mode, the deposit table extends up to the withdrawal year. Future deposits (2027–2030) default to 0 if left blank.
3. **Scenario A Logic**: Future planned deposits go into קרן השתלמות. Growth & fees apply. In 2030, monthly withdrawals begin using FIFO tax rules.
4. **Scenario B Logic**: Lump-sum exit tax on קרן השתלמות is paid **today (2026)**. Net proceeds are invested in Tool B today. Future planned deposits (2027–2030) go directly into Tool B as new principal. Growth & fees apply. In 2030, monthly withdrawals begin.
5. **Timeline & Visuals**: The monthly breakdown table and charts start from **today (2026)**, showing the accumulation phase first, followed by the withdrawal phase.

---

## Proposed Changes

### 1. User Interface & Inputs (`index.html`, `styles.css`, `app.js`)

- Add a global parameter field: **"שנת תחילת משיכות" (`withdrawalYear`)** inside the Global Parameters card.
  - Default value: Current year (2026).
  - Min value: Current year.
- In **Tool A — Yearly Mode**:
  - Dynamically generate deposit table rows from `startYear` up to `max(2026, withdrawalYear)`.
  - When the user changes `withdrawalYear` or `startYear`, regenerate/update the table rows accordingly without losing existing values.
  - Blank inputs default to 0.
  - Auto-calculate historical/future tax-free ceilings for each year.

---

### 2. Core Calculation Engine (`engine.js`)

- Update `calculateScenarioA(params)` and `calculateScenarioB(params)`:
  - Add parameter `withdrawalYear` (default: current year).
  - Calculate `growthMonths = Math.max(0, (withdrawalYear - currentYear) * 12)`.

#### Scenario A Logic
```
Month 1 to growthMonths (Accumulation Phase):
  1. Add any future planned deposit for the current month/year to Tool A.
  2. Grow Tool A deposits (annualGrowth monthly rate).
  3. Deduct Tool A monthly management fee.
  4. Withdrawal = 0, Tax = 0, Net = 0.
  5. Record monthly data point.

Month growthMonths + 1 onwards (Withdrawal Phase):
  1. Grow Tool A deposits & deduct fee.
  2. Perform inflation-adjusted withdrawal using FIFO logic from oldest deposits.
  3. Calculate tax on taxable profit portion (25%).
  4. Record monthly data point.
  5. Repeat until deposits are exhausted.
```

#### Scenario B Logic
```
Today (currentYear):
  1. Evaluate Tool A deposits up to currentYear.
  2. Calculate lump-sum exit tax on Tool A (25% on taxable profit).
  3. netProceeds = totalValueToday - lumpSumTax.
  4. Invest netProceeds into Tool B today (principal = netProceeds, currentValue = netProceeds).

Month 1 to growthMonths (Accumulation Phase):
  1. If in Yearly Mode, add any future planned deposit for this month/year directly into Tool B (increasing both principal and currentValue).
  2. Grow Tool B (toolBGrowth monthly rate).
  3. Deduct Tool B monthly management fee (toolBFee).
  4. Withdrawal = 0, Tax = 0, Net = 0.
  5. Record monthly data point (cumulativeTax includes initial lumpSumTax).

Month growthMonths + 1 onwards (Withdrawal Phase):
  1. Grow Tool B & deduct fee.
  2. Perform inflation-adjusted withdrawal.
  3. Calculate tax on Tool B profit portion (toolBTaxRate).
  4. Record monthly data point.
  5. Repeat until Tool B is exhausted.
```

---

### 3. Charts & Breakdown Table (`charts.js`, `app.js`)

- Charts display the full timeline from Month 1 (today).
- Visual curve:
  - Line charts will show initial balance growth (if `withdrawalYear > 2026`) followed by the withdrawal decline curve.
  - Summary metrics report:
    - Total tax paid (including lump-sum exit tax for Scenario B).
    - Total net received.
    - Total duration (accumulation months + withdrawal months).
    - Effective tax rate.

---

## Verification Plan

### Automated / Script Verification
- Run `node scratch/test_engine.js` with test cases:
  - Case 1: `withdrawalYear = 2026` (immediate withdrawal, existing behavior maintained).
  - Case 2: `withdrawalYear = 2030` (4 years of accumulation before withdrawal).
  - Case 3: Planned future deposits (2027–2030) in Yearly Mode.

### Manual Verification
- Test in browser:
  - Change `withdrawalYear` to 2030, verify deposit table expands up to 2030.
  - Leave blank years, verify they default to ₪0 without NaN errors.
  - Verify charts display accumulation phase followed by withdrawal phase.
