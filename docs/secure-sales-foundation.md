# Batch-aware secure sales foundation

## Status

This is an additive, server-controlled checkout. When
`settings/secureSales.enabled == true`, browser checkout first obtains a
server-authoritative quote and displays its subtotal, tax breakdown, and final
payable amount before confirmation. Submission must include that quote's
fingerprint; any price or tax change requires a new confirmation. An absent flag
is disabled. Production remains disabled and no production document is changed
by this branch.

## Authoritative model

- `stockBatches.remainingBaseQuantity` is authoritative.
- `products.quantity` is an atomically maintained projection of every remaining
  physical unit, including expired and quarantined batches.
- `products.sellableQuantity` is the separate projection of active, unexpired,
  valid-expiry-or-undated batches.
- `stockMovements` are immutable sale allocation records. Existing receipts and
  legacy sales are retained unchanged.
- Secure sales require `inventorySchemaVersion: 2`,
  `pricingStatus: "approved"`, and a positive integer
  `sellingPricePesewas`. No receipt/batch price or zero value is inferred.

Product bulk pricing is optional. When absent, the server derives it from the
approved base price and that product's positive safe-integer `unitsPerBulk`.
All sale quantities are whole base units.

## Allocation and expiry

Business dates use `Africa/Accra`. A `YYYY-MM-DD` expiry is sellable through
that local business date and is expired on the following date. Valid dated stock
is allocated FEFO; undated stock follows FIFO. Both use `receivedAt`, then
`batchId`, as deterministic tie-breakers. Malformed expiry data blocks the
product until the batch is quarantined.

The callable reads at most 20 products and 10 batches per product. A product with
more than 10 batches is rejected with `resource-exhausted` rather than receiving
a partial or nondeterministic allocation. The maximum transaction write count is
bounded below Firestore's 500-write limit.

## Money and snapshots

All secure monetary values are integer pesewas. A batch stores
`totalLandedCostPesewas`; allocation uses cumulative integer division:

`floor(totalCost * consumedAfter / originalQuantity) - floor(totalCost * consumedBefore / originalQuantity)`

This preserves an exact batch total for fractional per-unit costs without
floating-point rounding. Secure sale documents snapshot product name, pricing,
tax, conversion, batch allocation, expiry, and allocated cost. They also retain
legacy-compatible GHS fields (`items[].unitPrice`, `items[].total`,
`subtotalAmount`, `totalAmount`, and `taxBreakdown`) for reporting/receipt
read compatibility.

## Rules and legacy paths

When secure mode is disabled, existing client sales and receipt workflows retain
their legacy permissions. When enabled, rules deny client writes to
`stockBatches`, `stockMovements`, `saleRequests`, `sales`, product
quantity projections, and `stockReceipts`. The browser's legacy sale, receipt,
and adjustment services explicitly fail before writing when they observe the
secure flag. There is deliberately no fallback to legacy checkout after a secure
call failure.

Secure receiving, returns, and adjustments require their own server transaction
before secure mode can be used operationally. They are intentionally blocked now
instead of diverging from batch authority. Staging secure-sales testing is a
checkout rehearsal, not a complete operational rollout; see
`docs/staging-secure-sales-rehearsal.md`.

## Rehearsal and reconciliation

`npm --prefix functions run seed:secure-rehearsal` creates only named synthetic
fixtures and accepts only `demo-jyaano` (with an emulator) or `jyaano-staging`
with `JYAANO_ALLOW_SYNTHETIC_STAGING=true`. It rejects every other project,
including production.

`npm --prefix functions run reconcile:secure` requires
`JYAANO_RECONCILIATION_DRY_RUN=true`, writes nothing, and exits non-zero for
unresolved pricing or aggregate/batch discrepancies. It is not a production
migration tool.

`npm run emulators:secure-sales` runs callable and Firestore-rule integration
coverage against the demo emulators. The batch lookup uses one equality filter on
`stockBatches.productId`; Firestore's automatic single-field index is sufficient.
No composite index is required.

## Cutover prerequisites

1. Migrate and reconcile products/batches in staging, including quarantined data.
2. Obtain manager approval for every canonical product price.
3. Implement server-authoritative receiving, returns, and adjustments.
4. Complete a staging quote/confirmation rehearsal with durable idempotency
   drafts and no fallback on failure.
5. Verify printers and legacy receipt rendering against secure-sale documents.
6. Deploy rules and Functions only through an approved cutover; do not enable the
   production flag beforehand.
