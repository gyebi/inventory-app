import assert from "node:assert/strict";
import test from "node:test";
import { applyInitialLegacySellingPrice } from "../js/services/legacyReceivingCore.js";

test("legacy receiving initializes an unset selling price with the original receipt timestamps", () => {
  const product = { sellingPrice: 0 };
  const receipt = { unitSellingPrice: 6.5, purchaseDate: "2026-10-15T08:00", receivedAt: "2026-10-16T10:00" };
  assert.equal(applyInitialLegacySellingPrice(product, receipt, 12), true);
  assert.deepEqual(product, {
    sellingPrice: 6.5,
    bulkSellingPrice: 78,
    sellingPriceEffectiveDate: "2026-10-15T08:00",
    sellingPriceUpdatedAt: "2026-10-16T10:00"
  });
});

test("legacy receiving does not replace an existing price", () => {
  const product = { sellingPrice: 4, bulkSellingPrice: 48 };
  assert.equal(applyInitialLegacySellingPrice(product, { unitSellingPrice: 6.5 }, 12), false);
  assert.deepEqual(product, { sellingPrice: 4, bulkSellingPrice: 48 });
});
