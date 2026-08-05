# Product, Batch, and Pricing Rules

This document records the agreed stock, batch, and pricing behavior for the inventory app.

## Agreed Rules

- Product creation contains no purchase cost.
- Cost and initial selling price are entered when stock is received.
- Every stock receipt creates a unique batch ID.
- Every batch permanently retains its original unit cost.
- A supplier cost increase creates a new batch; it does not modify an old batch.
- Admin or Manager can change the current selling price.
- The new selling price applies to all remaining stock of that product from the effective date.
- Price-change history records the active batch IDs affected.
- Every completed sale stores its batch ID, unit cost, and actual selling price.
- Historical batches and completed sales must never be rewritten because of later price changes.

## Implementation Intent

- Batch-level purchase cost is immutable after receipt.
- Selling price changes are prospective and do not rewrite prior sales.
- Reports should preserve original batch and sale economics for auditability.

## Notes

- This document is the source of truth for the intended batch and pricing behavior until the codebase is fully aligned.
