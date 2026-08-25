# Finance Calc — Conversation Handoff

> **Conversation ID**: `7fa79385-cee9-48b5-afcf-0dc2155a3001`
> **Last Updated**: 2026-08-25
> **Status**: Stable — all features complete and verified.

---

## Project Overview

A pure browser-based Hebrew RTL investment comparison calculator (no backend, no build step).  
It compares two strategies for a **קרן השתלמות** (Israeli savings fund) at the point of withdrawal eligibility:

| | Strategy |
|---|---|
| **תרחיש א׳** | Keep funds in קרן השתלמות and withdraw gradually month-by-month |
| **תרחיש ב׳** | Cash out the קרן השתלמות today (pay exit tax), reinvest the net proceeds into a taxable trading account |

**Location**: `c:\Users\eyall\local personal\ai_projects\finance_calc\`

---

## File Structure

| File | Role |
|---|---|
| [`index.html`](file:///c:/Users/eyall/local%20personal/ai_projects/finance_calc/index.html) | Hebrew RTL UI, all input fields, canvas elements for charts |
| [`styles.css`](file:///c:/Users/eyall/local%20personal/ai_projects/finance_calc/styles.css) | Dark glassmorphism theme, RTL layout, responsive |
| [`engine.js`](file:///c:/Users/eyall/local%20personal/ai_projects/finance_calc/engine.js) | Pure calculation engine — no DOM. Exposes `window.CalculationEngine` |
| [`app.js`](file:///c:/Users/eyall/local%20personal/ai_projects/finance_calc/app.js) | DOM wiring, input handling, validation, calls engine & charts |
| [`charts.js`](file:///c:/Users/eyall/local%20personal/ai_projects/finance_calc/charts.js) | Chart.js wrappers — balance, cumulative tax, net income, bar breakdown |
| [`README.md`](file:///c:/Users/eyall/local%20personal/ai_projects/finance_calc/README.md) | Hebrew project documentation |

No npm, no bundler. All dependencies loaded via CDN (`Chart.js`).

---

## Input Modes

The UI supports two input modes toggled by a checkbox (`#inputModeToggle`):

### 1. Summary Mode (`#summaryMode`)
User enters a single **total balance** and **total principal** directly.  
These map to a single `Deposit` object passed to the engine.

### 2. Yearly Deposits Mode (`#yearlyMode`)
User enters a table of annual deposit amounts (from `startYear` to `withdrawalYear`).  
- `generateYearlyDepositsTable()` creates a row per year.
- Each year's deposit amount is split against the historical tax-free ceiling (`splitDepositByCeiling()`) to compute `taxFreeRatio`.
- `calculateDepositCurrentValues()` converts yearly inputs → array of `Deposit[]` passed to the engine.
- **Optional**: user can also enter **current funds** (`yearlyTotalBalance`) — triggers the CAGR solver to back-solve historical growth.

> [!IMPORTANT]
> **On page reload**, the browser restores the checkbox state. The `DOMContentLoaded` handler now reads the actual checkbox state and syncs the visible section. This was a bug that was fixed.

---

## Engine Architecture (`engine.js`)

### Exported API (`window.CalculationEngine`)

```javascript
CalculationEngine.calculateScenarioA(params)  → ScenarioResult
CalculationEngine.calculateScenarioB(params)  → ScenarioResult
CalculationEngine.calculateDepositCurrentValues(yearlyDeposits, annualGrowth, annualFee, currentYear, currentBalanceToday?)  → Deposit[]
CalculationEngine.splitDepositByCeiling(annualDeposit, year)  → taxFreeRatio (0–1)
CalculationEngine.getHistoricalCeilings()  → { year: maxTaxFreeAmount }
```

### Key Data Types

```javascript
// Input per deposit:
{ principal, currentValue, taxFreeRatio, year? }

// Output per month:
{ month, withdrawal, tax, netReceived, remainingBalance, cumulativeTax, cumulativeNet, cumulativeWithdrawal }

// Scenario summary:
{ totalTax, totalNetReceived, totalWithdrawn, monthsToExhaustion, effectiveTaxRate }
```

### Calculation Flow — Scenario A (Gradual Withdrawal)

1. **Accumulation phase** (`withdrawalYear > currentYear`): deposits grow without withdrawal until `withdrawalYear`.
2. Each month: GROW → FEE → WITHDRAW (FIFO with FIFO tax).
3. **FIFO tax**: each deposit tracks its own `taxFreeRatio`; withdrawals are split proportionally into taxable/non-taxable profit, then principal.
4. Inflation adjusts the monthly withdrawal amount over time.
5. Future planned deposits (yearly mode) are injected into `activeDeposits` at their target year.

### Calculation Flow — Scenario B (Lump-Sum Exit + Reinvest)

1. **Today**: compute total exit tax on all קרן השתלמות deposits (FIFO, 25% on taxable profit).
2. Net proceeds = total value − exit tax → deposited into Tool B.
3. **Month 0 data point** shows Tool B balance = net proceeds (already reduced by exit tax), cumulative tax = exit tax.
4. Tool B grows and withdrawals are taxed at the user-specified `toolBTaxRate`.

### Tax Calculation Rules

- Profit above tax-free ceiling: **25% tax** (`TAX_RATE_KEREN = 0.25`)
- `taxFreeRatio` per deposit: `min(annualDeposit, ceilingForYear) / annualDeposit`
- Historical ceilings:
  - 1995–2003: ₪17,400/year
  - 2004–2060: ₪18,854.40/year
- FIFO withdrawal order: oldest deposit first, within deposit proportional profit ratio.

### `calculateDepositCurrentValues` — Monthly Granularity

> [!IMPORTANT]
> Each annual deposit is **split into 12 equal monthly sub-deposits** (amount ÷ 12).  
> Each sub-deposit accrues returns only from **its own deposit month** forward.

**Elapsed months formula** for month index `m` (0=Jan, 11=Dec) in year `Y`:
```
elapsed = max(0, (currentYear - Y) * 12 - m)
```

Sub-deposits are sorted oldest→newest (most elapsed first) to preserve FIFO order.

**Expected growth mode**: `value = principal × ((1 + mgr) × (1 − mfr))^elapsedMonths`

**CAGR solver mode** (when `currentBalanceToday` provided):  
80-iteration bisection finds annual rate `r` such that:
```
Σ (monthlyPrincipal × (1+r)^(elapsedMonths/12)) = currentBalanceToday
```

**Validation**: if `currentBalanceToday < sum of all past contributions`, the app blocks calculation with a Hebrew error message.

---

## Charts (`charts.js`)

Four Chart.js charts, all managed by `ChartManager`:

| Chart | ID | Content |
|---|---|---|
| Balance over time | `balanceChart` | Line: remaining balance A vs B |
| Cumulative tax | `taxChart` | Line: cumulative tax A vs B |
| Net income | `netChart` | Line: cumulative net received A vs B |
| Summary bar | `breakdownChart` | Bar: total tax vs net vs withdrawn |

> [!IMPORTANT]
> X-axis direction: **left-to-right** (`reverse: false`). Month 0 = `'התחלה'` (leftmost), then `'שנה 1'`, `'שנה 2'`, etc. every 12 months.  
> This was fixed after an earlier RTL chart bug.

Charts are downsampled to max 200 data points for performance (`prepareLineData()`).

---

## UI/App Layer (`app.js`)

### Input Parsing
- Currency fields (`monthlyWithdrawal`, `totalBalance`, `totalPrincipal`, `yearlyTotalBalance`) use **`type="text" inputmode="numeric"`** (not `type="number"`) to prevent browser wiping formatted values with commas on blur.
- `setupNumberFormatting()` handles focus-in/focus-out formatting.

### Mode Toggle Sync on Reload (Bug Fix)
`DOMContentLoaded` reads `#inputModeToggle.checked` and applies the matching CSS classes to `#summaryMode` and `#yearlyMode`. This prevents a stale display state when the browser restores checkbox state across reloads.

### Breakdown Table
- Row for `month === 0` displays as **"התחלה"** with highlighted background.
- For Scenario B, the starting row shows `⚡ ₪X (מס יציאה)` in the tax column.
- "Show more" button reveals all rows beyond the default 120 (10 years).

### Validation Errors (Hebrew)
- `currentBalanceToday < totalPastContributions` → blocks calculation with clear error message.
- `withdrawalYear` missing or invalid → defaults to current year.

---

## Known Design Decisions

| Decision | Rationale |
|---|---|
| `type="text"` for currency inputs | `type="number"` silently clears comma-formatted values on blur |
| Monthly sub-deposits (÷12) | More accurate than lump-sum annual: each month's contribution earns return from its actual deposit date |
| Month 0 in `monthlyData` | Ensures charts and tables show the starting state before any growth — critical for showing initial exit tax gap in Scenario B |
| FIFO tax per deposit | Matches Israeli tax authority rules for קרן השתלמות |
| Bisection (80 iterations) | Fast and sufficient for ~machine-precision CAGR convergence |
| Safety cap: 1200 months | Prevents infinite loops when monthly withdrawal < monthly growth |

---

## Testing

Scratch test file: [`test_engine.js`](file:///C:/Users/eyall/.gemini/antigravity/brain/7fa79385-cee9-48b5-afcf-0dc2155a3001/scratch/test_engine.js)

Run:
```powershell
node "C:\Users\eyall\.gemini\antigravity\brain\7fa79385-cee9-48b5-afcf-0dc2155a3001\scratch\test_engine.js"
```

| Test | What it verifies |
|---|---|
| Case 1 | Immediate withdrawal — basic tax & net sanity |
| Case 2 | Delayed withdrawal (4-year accumulation phase) — Month 0 data points |
| Case 3 | Future planned deposits (2027, 2028) |
| Case 4 | CAGR solver: sum of monthly sub-deposit values ≈ `currentBalanceToday` (₪299,999.99 ≈ ₪300,000) ✓ |

---

## Open Items / Possible Next Steps

- No automated CI — tests are manual Node.js runs.
- Historical ceiling data hardcoded up to year 2060; may need updating if tax law changes.
- Tool B tax rate is user-entered (not auto-computed) — user is responsible for entering the correct capital gains rate.
- The yearly deposits table start year is hardcoded to `DEFAULT_START_YEAR = 2000`; a user-editable start year exists but resets to 2000 on each load.
