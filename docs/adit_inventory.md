# Adit Inventory Audit

Date: 2026-09-01

## Scope

This audit reviews the current inventory app to determine:

- what is already in place and working
- what is needed for receipt printing
- what is needed for end-of-day (EOD) closeout
- what reports currently exist
- what can be improved next

## Summary

The app already has a solid base for sales, stock, receipts, and printable dashboard reports. Receipt generation exists, and both receipts and reports can be printed through the browser.

The biggest gap is that there is no dedicated EOD workflow yet. There is no official closeout record, cash reconciliation, shift balancing, or locked daily summary. The current reports are useful, but they are still general operational reports rather than a full retail closeout suite.

## What Is Already Working

### Sales

- Sales are recorded with structured sale objects.
- Sales support item lines, totals, profit, tax breakdown, and cashier attribution.
- Stock is reduced from available batches when a sale is completed.
- Expired batches are excluded from selling.

### Receipts

- A receipt view is rendered after a sale completes.
- The receipt includes:
  - business name
  - receipt ID
  - cashier name
  - date/time
  - line items
  - subtotal and tax breakdown where enabled
  - total amount
- Receipt printing is available through the browser print dialog.
- Receipt text formatting already exists for receipt output.

### Reports

- A dedicated reports page exists.
- Reports can be opened in a modal and printed.
- Date filters exist for several reports.
- A salesperson filter exists for the profit report.
- Inventory, purchases, stock movement, low stock, reorder, and supplier payable reports already exist.

### Backend / Sync

- Firebase sync is already present for products, sales, and stock receipts.
- Cloud transactions are used for inventory operations.
- Staff user management exists in Cloud Functions.

## Receipt Printing Readiness

Current state:

- Receipt printing works through `window.print()`.
- The receipt page is already styled as a printable view.
- There is a print button on the receipt screen.

What is missing or weak:

- There is no dedicated receipt printer integration.
- There is no automatic print-on-complete option.
- There is no stored print status, so reprints are not tracked.
- There is no receipt search/reprint screen by receipt ID.
- There is no PDF export or alternate receipt output path.

Recommended improvements:

1. Add an optional auto-print toggle after sale completion.
2. Add a receipt archive screen with search by receipt ID, date, cashier, and customer if available.
3. Add a dedicated print stylesheet for POS receipt paper sizes.
4. Support reprint tracking so copied receipts are distinguishable from originals.
5. If a thermal printer is required, define a browser-to-printer workflow early instead of relying only on standard browser print.

## EOD Readiness

Current state:

- There is no dedicated EOD module.
- There is no closeout record or daily balancing table.
- There is no till count, opening float, closing float, or variance capture.
- There is no daily lock that prevents edits after close.
- There is no signed EOD approval or manager confirmation flow.

What the app can do today:

- The reports page can show daily sales, stock movement, purchase activity, and profit summaries.
- That is enough for a manual review, but not enough for a proper closeout process.

What a real EOD workflow still needs:

- opening cash float
- sales by payment method
- expected cash in till
- counted cash entered by cashier or manager
- variance calculation
- returns/voids/discounts/adjustments summary
- stock movement summary for the day
- final lock and timestamp
- printable EOD report
- audit trail of who closed the day

Recommended improvements:

1. Create an `EOD Close` workflow as a first-class feature.
2. Store one close record per business day or per shift.
3. Include cash reconciliation and variance checks.
4. Lock or snapshot sales and adjustments after close.
5. Add a printable EOD summary for managers.

## Reports That Already Exist

These reports are currently available in the app:

- Product Report
- Low Stock Report
- Reorder Report
- Sales by Product Report
- Daily/Weekly/Monthly Sales Report
- Sales Report by Sales Person
- Stock Movement Report
- Batch Stock Report
- Damaged/Lost Items Report
- Purchase Report
- Inventory Valuation Report
- Supplier Amount Owed Report

## Report Quality Review

### Strong areas

- Good coverage of core inventory operations.
- Useful operational summaries already exist.
- Reports support printing.
- Batch-level stock reporting is more advanced than many basic inventory apps.

### Gaps

- No dashboard summary for EOD closeout.
- No cash drawer report.
- No sales payment method breakdown.
- No void/return/discount/complaint report.
- No stock ageing or expiry risk report.
- No margins report by product or category.
- No KPI-style export for management.
- No saved report snapshots for historical comparison.

### Structural issue

- `js/services/reportService.js` is empty, while the live reporting logic is embedded in `js/pages/dashboard.js`.
- That makes reporting harder to maintain and harder to test.

## What Could Be Better

### 1. Separate reporting logic from page rendering

Move report calculations into a real service module and keep the page layer focused on rendering.

Why this matters:

- easier to test
- easier to reuse for exports and EOD
- less risk of duplicated logic

### 2. Add proper EOD records

Right now the app can summarize activity, but it does not close the books.

Why this matters:

- managers need daily cash control
- auditors need a close record
- staff accountability improves

### 3. Make receipts more operational

Receipts should be easy to print, reprint, and audit.

Why this matters:

- faster cashier workflow
- less dependency on manual browser steps
- better support for customer disputes

### 4. Add missing management reports

The current reports are strong on stock movement, but weak on financial closeout and risk visibility.

Priority additions:

- cash reconciliation
- payment method breakdown
- void/return/discount report
- expired stock exposure report
- margin by product/category
- top-selling products over time

### 5. Add export and archival support

Printing alone is not enough for longer-term operational use.

Recommended outputs:

- PDF export
- CSV export
- saved daily summary snapshots
- searchable receipt history

## Recommended Roadmap

### Phase 1: Stabilize receipt printing

- Add auto-print option after successful sale.
- Add a dedicated receipt archive/search view.
- Improve print styling for receipt paper.
- Track receipt reprints.

### Phase 2: Build EOD closeout

- Add daily or shift-based close records.
- Capture expected cash versus counted cash.
- Add variance and approval fields.
- Print a formal EOD report.

### Phase 3: Strengthen reporting

- Move report calculations into `reportService.js`.
- Add cash/payment-method reports.
- Add gross margin and expiry risk reports.
- Add export support.

### Phase 4: Governance and audit trail

- Lock or snapshot closed days.
- Track who closed the day.
- Track adjustments after close.
- Add filtered history views for managers.

## Bottom Line

The app is already usable for sales, stock control, receipts, and operational reporting.

It is not yet a complete retail closeout system because it lacks:

- formal EOD close
- cash reconciliation
- receipt archival
- reprint tracking
- deeper financial reports

If the next goal is to support a real shop floor workflow, the best next step is to build a proper EOD module and a receipt archive before adding more report types.
