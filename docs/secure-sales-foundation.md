# Secure sales foundation (A1.2)

## Status and scope

`submitSecureSale` is an additive callable Function foundation. It is not called by the existing browser checkout, has not been deployed, and does not change Firestore rules. Existing Linux RFCOMM, Windows bridge, Web Serial, browser/PDF printing, legacy sales, and receipt rendering are unchanged.

The command is intentionally unsafe to activate against the current production product data: it rejects products without a canonical product-level selling price. This is preferable to silently selecting a receipt/batch price from client-era records.

## Current-data finding and required decision

Current production product records store aggregate `quantity`, unit metadata, and no canonical `sellingPrice` or `bulkSellingPrice`. Current prices live in `stockReceipts.unitSellingPrice` and are replayed in the browser with local batch state. The browser also rebuilds remaining batches from receipt history and legacy sale `items[].batchAllocations`.

There is no approved, server-authoritative answer to both of these questions:

1. Is the sale price a current product price, a selected batch price, or a manager-approved override?
2. If batch price applies, which batches are consumed and how are adjustments, returns, and historic records reconciled?

Before activation, approve one policy:

- **Product aggregate policy:** persist canonical product `sellingPrice` and optional `bulkSellingPrice`; inventory remains aggregate-only. This requires a compatible replacement for the current browser batch reconstruction.
- **Batch policy:** introduce an authoritative batch/movement model and server-side FEFO/allocation rules before a secure sale can commit.

This phase implements only the first policy as a strict testable contract. It never falls back to `stockReceipts` pricing and it does not write `batchAllocations`.

## Callable contract

Callable name: `submitSecureSale`

Request:

```json
{
  "idempotencyKey": "sale-request-000001",
  "items": [
    { "productId": "water", "quantity": 2, "unit": "base" }
  ],
  "paymentMethod": "cash"
}
```

- `idempotencyKey`: 16–128 URL-safe characters. The client must generate and persist it before its first request and reuse it after a timeout or unknown result.
- `items`: one to fifty distinct product IDs; `quantity` is a positive integer; `unit` is exactly `base` or `bulk`.
- `paymentMethod` is optional because current checkout does not require it. If present it is one of `cash`, `mobile_money`, `card`, `credit`, or `other`.
- Client prices, totals, tax, staff data, stock quantities, discounts, and arbitrary request fields are rejected.

Successful response:

```json
{
  "saleId": "SEC-...",
  "committed": true,
  "committedAt": "2026-10-15T00:00:00.000Z",
  "currency": "GHS",
  "paymentMethod": "cash",
  "createdBy": { "uid": "...", "fullName": "...", "role": "sales" },
  "items": [{ "productId": "water", "baseQuantity": 2, "unitPricePesewas": 600 }],
  "subtotalPesewas": 1200,
  "taxBreakdown": { "taxAmountPesewas": 240, "totalAmountPesewas": 1440 },
  "totalAmountPesewas": 1440
}
```

The response is canonical committed receipt data. Physical-print status remains separate and is not claimed by this command.

## Transaction and idempotency behavior

Within one Firestore transaction, the Function:

1. Reads a deterministic `saleRequests/{sha256(uid + key)}` document.
2. Returns the stored canonical response for an identical request; rejects reuse of the key with different content.
3. Reads the caller profile, tax configuration, and affected products before writing.
4. Requires an existing active `admin` or `sales` profile and derives attribution from that profile and Firebase UID.
5. Validates aggregate stock, calculates GHS values in integer pesewas, and deducts product quantities.
6. Writes the new `sales/SEC-...` record and idempotency record atomically.

The transaction has no external side effects, so Firestore retries are safe. A client retry after a lost response reads the idempotency record and returns the original sale rather than applying another deduction.

Tax policy is the existing `settings/tax` model, normalized on the server. VAT, NHIL, and GETFund are added to the total; withholding VAT is calculated and reported but is not added, matching current client behavior. A missing tax document uses the current application defaults.

## Proposed additive data shape

No production document has been created by this branch. When approved and invoked, the Function would add:

- `saleRequests/{requestHash}`: caller UID, request fingerprint, deterministic sale ID, canonical response, and server timestamp.
- `sales/SEC-{requestHashPrefix}`: `schemaVersion: 2`, pesewa monetary fields, server attribution, and `idempotencyKeyHash`.

No Firestore index is required: transaction reads use direct document references only.

Existing sales retain their legacy GHS-number fields and batch allocations. The current checkout and receipt pages do not yet understand the v2 pesewa schema, which is intentional because this branch does not switch checkout.

## Future cutover requirements

1. Approve and migrate the canonical pricing and batch policy.
2. Add emulator tests for the approved batch/movement model and production-data migration rehearsal.
3. Integrate checkout behind a controlled rollout flag; persist and reuse the idempotency key in a durable client draft.
4. Update receipt rendering to consume canonical v2 data while retaining legacy rendering.
5. Deploy Firestore rules with the cutover: clients must no longer create `sales`, mutate product quantities, or write the idempotency collection directly. The server Admin SDK remains the only writer for committed sales and inventory deductions.
6. Add active-profile enforcement and least-privilege reads to rules as part of that separately approved security rollout.

Do not deploy this Function or rules before those decisions and compatibility work are approved.
