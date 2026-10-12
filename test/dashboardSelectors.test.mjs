import assert from "node:assert/strict";
import test from "node:test";
import {
  getExpiryAlerts,
  getLowStockProducts,
  getSalesTrend,
  getStockValuation,
  getTodaySales
} from "../js/dashboardSelectors.js";

test("dashboard sales selectors only count sales on the requested day", () => {
  const reference = new Date("2026-10-12T12:00:00");
  const sales = [
    { totalAmount: 18, createdAt: "2026-10-12T08:00:00" },
    { totalAmount: 22, createdAt: "2026-10-11T23:59:00" },
    { items: [{ total: 5 }], createdAt: "2026-10-12T18:00:00" }
  ];

  assert.equal(getTodaySales(sales, reference), 23);
  assert.deepEqual(getSalesTrend(sales, reference, 2).map((point) => point.amount), [22, 23]);
});

test("low stock excludes inactive products and uses product-specific thresholds", () => {
  const products = [
    { id: "1", name: "A", quantity: 2, lowStockThreshold: 3 },
    { id: "2", name: "B", quantity: 1, active: false },
    { id: "3", name: "C", quantity: 8 }
  ];

  assert.deepEqual(getLowStockProducts(products, { lowStockThreshold: 5 }).map((item) => item.id), ["1"]);
});

test("expiry alerts handle expired and soon-to-expire stocked batches", () => {
  const alerts = getExpiryAlerts([
    { productId: "a", quantity: 4, expiryDate: "2026-10-11" },
    { productId: "b", quantity: 2, expiryDate: "2026-10-24" },
    { productId: "c", quantity: 5, expiryDate: "2026-12-01" }
  ], [{ id: "a", name: "Maize" }, { id: "b", name: "Rice" }], new Date("2026-10-12T12:00:00"));

  assert.deepEqual(alerts.map((alert) => [alert.productName, alert.status]), [["Maize", "Expired"], ["Rice", "Expiring soon"]]);
});

test("stock valuation is withheld if a product with stock has no cost price", () => {
  assert.deepEqual(getStockValuation([{ quantity: 3, costPrice: 4 }]), { supported: true, amount: 12 });
  assert.deepEqual(getStockValuation([{ quantity: 3 }]), { supported: false, amount: null });
});
