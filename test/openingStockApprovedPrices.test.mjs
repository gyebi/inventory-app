import assert from "node:assert/strict";
import test from "node:test";
import { resolvePersistedProductSellingPrice } from "../js/services/productPriceResolver.mjs";

test("activated opening-stock prices retain the explicit bulk approval after reload", () => {
  const reloadedProduct = {
    baseUnit: "Bottle",
    bulkUnit: "Pack",
    unitsPerBulk: 12,
    sellingPrice: 3,
    bulkSellingPrice: 32
  };

  assert.equal(resolvePersistedProductSellingPrice(reloadedProduct, "base"), 3);
  assert.equal(resolvePersistedProductSellingPrice(reloadedProduct, "bulk"), 32);
  assert.equal(resolvePersistedProductSellingPrice({ ...reloadedProduct, bulkSellingPrice: 0 }, "bulk"), 36);
});
