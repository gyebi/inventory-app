# Dashboard calculations

The V1.5 dashboard is a read-only view over the application state already kept in sync by the product, sales, and stock-receipt services. It creates no collections and starts no additional Firestore listeners.

- **Today's sales**: the sum of `sale.totalAmount` for sales whose `createdAt` falls on the local calendar day. Older sale records use `sale.total`, or the sum of `sale.items[].total` when those fields are available.
- **Active products**: products not explicitly marked `active: false` or `isActive: false`. The current product model treats records as active unless one of those flags is present.
- **Low stock**: active products where `quantity <= product.lowStockThreshold`, falling back to `settings.lowStockThreshold` (then `10`). This follows the same quantity and threshold rules used by the existing dashboard reports.
- **Sales trend**: sales totals grouped by local calendar day for the last seven days, including days with no transactions as zero.
- **Recent sales**: the five records with the newest valid `createdAt` (with the legacy `date` and `syncedAt` fallbacks), displaying the existing stored sale amount.
- **Expiry alerts**: batches in `state.stock` with a positive quantity and an `expiryDate` before the next 30 days. Past dates are marked expired. No alert is shown when batch expiry data is absent.
- **Stock valuation**: displayed only when every active product with positive quantity has a finite `costPrice`. Formula: `sum(product.quantity * product.costPrice)`. The values are from the existing product inventory snapshot and product cost price, in the product's stored base unit. If cost coverage is incomplete, the card is intentionally omitted rather than estimating a value.

All displayed amounts use the application's existing receipt currency formatter.
