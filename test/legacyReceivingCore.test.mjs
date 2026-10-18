import assert from "node:assert/strict";
import test from "node:test";
import { applyInitialLegacySellingPrice, calculateLegacyReceivedQuantity } from "../js/services/legacyReceivingCore.js";

test("legacy receiving combines bulk and loose units once while blank fields remain zero", () => {
  assert.deepEqual(calculateLegacyReceivedQuantity({ bulkQuantityReceived: "2", looseBaseQuantityReceived: "3", unitsPerBulk: 12 }), {
    bulkQuantityReceived: 2, looseBaseQuantityReceived: 3, unitsPerBulk: 12, bulkBaseQuantity: 24, quantityReceived: 27
  });
  assert.equal(calculateLegacyReceivedQuantity({ bulkQuantityReceived: "", looseBaseQuantityReceived: "3", unitsPerBulk: 12 }).quantityReceived, 3);
  assert.equal(calculateLegacyReceivedQuantity({ bulkQuantityReceived: "2", looseBaseQuantityReceived: "", unitsPerBulk: 12 }).quantityReceived, 24);
  assert.throws(() => calculateLegacyReceivedQuantity({ bulkQuantityReceived: "", looseBaseQuantityReceived: "", unitsPerBulk: 12 }), /bulk, loose, or both/i);
  assert.throws(() => calculateLegacyReceivedQuantity({ bulkQuantityReceived: "1.5", looseBaseQuantityReceived: "", unitsPerBulk: 12 }), /whole number/i);
  assert.throws(() => calculateLegacyReceivedQuantity({ bulkQuantityReceived: "-1", looseBaseQuantityReceived: "", unitsPerBulk: 12 }), /whole number/i);
});

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
