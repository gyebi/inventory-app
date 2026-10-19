import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAndroidRawBtIntent,
  printAndroidRawBtReceipt
} from "../js/services/androidRawBtPrinterService.js";

const sale = () => ({
  id: "SEC-1234567890abcdef1234567890abcdef",
  createdAt: "2026-10-19T10:00:00.000Z",
  createdBy: { fullName: "Demo Cashier" },
  items: [{
    name: "Test mineral water with a deliberately long product name",
    quantity: 2,
    unit: "Bottle",
    unitPrice: 3,
    total: 6
  }],
  subtotalAmount: 6,
  totalAmount: 7.20,
  taxBreakdown: {
    enabled: true,
    subtotal: 6,
    vatRate: 15,
    nhilRate: 2.5,
    getfundRate: 2.5,
    vatAmount: 0.90,
    nhilAmount: 0.15,
    getfundAmount: 0.15,
    taxAmount: 1.20
  }
});

function decode(intent) {
  const match = /^intent:base64,([A-Za-z0-9+/=]+)#Intent;scheme=rawbt;package=ru\.a402d\.rawbtprinter;end;$/.exec(intent);
  assert.ok(match, "Intent must target the fixed RawBT package.");
  return Buffer.from(match[1], "base64").toString("ascii");
}

test("Android receipt retains items, taxes, reference and total without mutating sale", () => {
  const input = sale();
  const before = structuredClone(input);
  const payload = decode(buildAndroidRawBtIntent(input));

  for (const expected of [
    "Kay-Flo Enterprise", "Bottle", "Ghs 6.00",
    "NHIL", "GETFund", "VAT", "Ghs 7.20",
    "SEC-1234567890AB", "Demo Cashier"
  ]) {
    assert.ok(payload.includes(expected), expected);
  }
  assert.deepEqual(input, before);
});

test("Android receipt wraps at 32 columns and feeds only three final newlines", () => {
  const payload = decode(buildAndroidRawBtIntent(sale()));
  assert.ok(payload.startsWith("\x1b\x40"));
  assert.equal(payload.match(/\n+$/)[0], "\n\n\n");
  for (const line of payload.slice(2).trimEnd().split("\n")) {
    assert.ok(line.length <= 32, line);
  }
});

test("Receipt fields cannot inject printer control commands or Android intent parameters", () => {
  const input = sale();
  input.items[0].name = "Water\x1b\x64\xff\nInjected";
  input.createdBy.fullName = "Cashier#Intent;package=other;end;";
  const intent = buildAndroidRawBtIntent(input);
  const payload = decode(intent);

  assert.equal([...payload].filter((char) => char === "\x1b").length, 1);
  assert.equal(intent.split("#Intent;").length, 2);
  assert.ok(payload.includes("Water"));
});

test("Unsaved, malformed and oversized receipts reject instead of printing partial data", () => {
  for (const input of [
    null,
    { ...sale(), id: "" },
    { ...sale(), committed: false },
    { ...sale(), items: [] },
    { ...sale(), totalAmount: NaN },
    { ...sale(), totalAmount: -1 },
    { ...sale(), items: [{ ...sale().items[0], quantity: 0 }] },
    { ...sale(), items: [{ ...sale().items[0], unitPrice: Infinity }] },
    {
      ...sale(),
      items: Array.from({ length: 100 }, () => ({
        ...sale().items[0], name: "Long item ".repeat(100)
      }))
    }
  ]) {
    assert.throws(() => buildAndroidRawBtIntent(input));
  }
});

test("Direct Android print rejects unsupported devices before navigation", () => {
  if (!/Android/i.test(globalThis.navigator?.userAgent || "")) {
    assert.throws(() => printAndroidRawBtReceipt(sale()), /Android device/);
  }
});
