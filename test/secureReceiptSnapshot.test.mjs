import assert from "node:assert/strict";
import test from "node:test";
import { generateReceiptText } from "../js/services/receiptService.js";

test("receipt uses the immutable server bulk-unit label rather than the canonical bulk token", () => {
  const text = generateReceiptText({
    id: "SEC-TEST", createdAt: "2026-10-16T12:00:00.000Z", totalAmount: 72,
    items: [{ name: "Synthetic Water", quantity: 1, unit: "bulk", unitLabel: "Carton", unitPrice: 60, total: 60 }],
    taxBreakdown: { subtotal: 60, enabled: true, nhilRate: 2.5, getfundRate: 2.5, vatRate: 15, nhilAmount: 1.5, getfundAmount: 1.5, vatAmount: 9, taxAmount: 12, totalAmount: 72 }
  });
  assert.match(text, /Synthetic Water x1 Carton/);
  assert.doesNotMatch(text, /Synthetic Water x1 bulk/);
  assert.match(text, /TOTAL: Ghs 72\.00/);
});
