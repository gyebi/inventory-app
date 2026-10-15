import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Printer Settings exposes and persists the browser-only Web Serial output mode", async () => {
  const settingsSource = await readFile(new URL("../js/pages/printerSettings.js", import.meta.url), "utf8");

  assert.match(settingsSource, /Bluetooth \/ Web Serial Printer \(Chrome\)/);
  assert.match(settingsSource, /receiptPrinterType/);
  assert.match(settingsSource, /saveWebSerialPrinterPreferences/);
  assert.match(settingsSource, /connectWebSerialPrinter/);
  assert.match(settingsSource, /testWebSerialPrinterSettings/);
  assert.match(settingsSource, /navigator\.serial\.requestPort|webSerialPrinter\.connect/);
});

test("Sales navigation routes Web Serial receipts without changing browser or bridge modes", async () => {
  const salesSource = await readFile(new URL("../js/pages/sales.js", import.meta.url), "utf8");

  assert.match(salesSource, /printerType === "mpt58"/);
  assert.match(salesSource, /printerType === "web-serial"/);
  assert.match(salesSource, /renderWebSerialReceiptPage\(sale\)/);
  assert.match(salesSource, /renderReceiptPage\(sale\)/);
});
