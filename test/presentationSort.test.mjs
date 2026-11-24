import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  compareProductsForPresentation,
  sortPresentationValues,
  sortProductsForPresentation
} from "../js/utils/presentationSort.js";

test("presentation sorting normalizes case, whitespace, Unicode, and numeric names without mutating products", () => {
  const products = [
    { id: "10", name: "Item 10" },
    { id: "accent", name: "Caf\u00e9" },
    { id: "2", name: " item 2 " },
    { id: "decomposed", name: "Cafe\u0301" },
    { id: "upper", name: "APPLE" },
    { id: "lower", name: "apple" },
    { id: "blank", name: "   " },
    { id: "missing" }
  ];
  const original = structuredClone(products);

  const sorted = sortProductsForPresentation(products);

  assert.deepEqual(products, original);
  assert.deepEqual(sorted.map((product) => product.id).slice(2, 6), ["accent", "decomposed", "2", "10"]);
  assert.deepEqual(sorted.slice(-2).map((product) => product.id), ["missing", "blank"]);
  assert.deepEqual(sorted.slice(0, 2).map((product) => product.name).sort(), ["APPLE", "apple"]);
});

test("presentation sorting uses immutable product ID ties and preserves duplicate value entries", () => {
  const duplicates = [
    { id: "b", name: "Water" },
    { id: "a", name: "Water" }
  ];

  assert.deepEqual(sortProductsForPresentation(duplicates).map((product) => product.id), ["a", "b"]);
  assert.equal(compareProductsForPresentation({ id: "a", name: "Water" }, { id: "b", name: "Water" }) < 0, true);
  const categories = [" Water ", "water", "Item 10", "Item 2", ""];
  assert.deepEqual(sortPresentationValues(categories), ["Item 2", "Item 10", " Water ", "water", ""]);
  assert.deepEqual(categories, [" Water ", "water", "Item 10", "Item 2", ""]);
});

test("product and category views import the shared presentation sorter", async () => {
  const views = [
    ["js/pages/inventory.js", "sortProductsForPresentation"],
    ["js/pages/sales.js", "sortProductsForPresentation"],
    ["js/pages/receiveStock.js", "sortProductsForPresentation"],
    ["js/pages/openingStock.js", "sortProductsForPresentation"],
    ["js/pages/stocktakingPrototype.js", "sortPresentationValues"],
    ["js/pages/stockAdjustment.js", "sortProductsForPresentation"],
    ["js/pages/sellingPriceChanges.js", "sortProductsForPresentation"],
    ["js/pages/addProduct.js", "sortPresentationValues"],
    ["js/pages/categorySettings.js", "sortPresentationValues"],
    ["js/pages/dashboard.js", "sortProductsForPresentation"]
  ];

  for (const [path, utility] of views) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`import \\{ ${utility} \\} from .*presentationSort\\.js`));
    assert.match(source, new RegExp(`\\b${utility}\\(`));
  }
});
