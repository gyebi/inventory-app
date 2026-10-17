const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReceipt } = require("../formatter/receiptFormatter");

test("58mm receipts wrap long fields without dropping them", () => {
  const longReference = "SEC-61136997EDB1-EXTRA-LONG-REFERENCE";
  const longItem = "Very long item name that must remain readable on a narrow receipt";
  const receipt = buildReceipt({
    paperWidthMm: 58,
    receiptId: longReference,
    date: "Friday 17 October 2026 at 12:34:56 PM",
    cashier: "A cashier with a deliberately long display name",
    items: [{ name: longItem, quantity: 1, unit: "exceptionally long unit label", unitPrice: 1, total: 1 }],
    totalAmount: 1,
  });

  assert.match(receipt, /SEC-61136997EDB1-EXTRA-LONG-REFE\nRENCE/);
  assert.match(receipt, /Very long item name that must\nremain readable on a narrow\nreceipt/);
  assert.match(receipt, /1 exceptionally long\nunit label x 1\.00/);
  assert.ok(receipt.split("\n").every((line) => line.length <= 32));
});
