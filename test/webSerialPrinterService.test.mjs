import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_SERIAL_PREFERENCES_KEY,
  createWebSerialPrinter,
  getWebSerialPrinterPreferences,
  saveWebSerialPrinterPreferences,
} from "../js/services/webSerialPrinterService.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createPort({ write = async () => {} } = {}) {
  const writes = [];
  let closed = false;
  let openedWith = null;
  return {
    get closed() { return closed; },
    get openedWith() { return openedWith; },
    writes,
    writable: {
      getWriter() {
        return {
          write: async (payload) => {
            writes.push(payload);
            return write(payload);
          },
          releaseLock() {},
        };
      },
    },
    async open(options) { openedWith = options; },
    async close() { closed = true; },
  };
}

function createSerial(port) {
  const listeners = new Map();
  let requests = 0;
  return {
    addEventListener(name, listener) { listeners.set(name, listener); },
    async requestPort() { requests += 1; return port; },
    get requests() { return requests; },
    disconnect(portToDisconnect = port) { listeners.get("disconnect")?.({ target: portToDisconnect }); },
  };
}

const sampleSale = {
  id: "SALE-SYNTH-001",
  createdAt: "2026-10-14T12:00:00.000Z",
  createdBy: { fullName: "Test Cashier" },
  items: [{ name: "Synthetic Rice", quantity: 2, unit: "bag", unitPrice: 12.5, total: 25 }],
  subtotalAmount: 25,
  totalAmount: 25,
  taxBreakdown: { enabled: false },
};

test("Web Serial stores only safe printer preferences", () => {
  const storage = createStorage();
  assert.deepEqual(getWebSerialPrinterPreferences(storage), { baudRate: 9600, paperWidthMm: 58 });

  assert.deepEqual(
    saveWebSerialPrinterPreferences({ baudRate: 19200, paperWidthMm: 80, deviceId: "must-not-persist" }, storage),
    { baudRate: 19200, paperWidthMm: 80 },
  );
  assert.deepEqual(JSON.parse(storage.getItem(WEB_SERIAL_PREFERENCES_KEY)), { baudRate: 19200, paperWidthMm: 80 });
});

test("Web Serial requires a user-selected port and supports manual disconnect/reconnect", async () => {
  const storage = createStorage();
  saveWebSerialPrinterPreferences({ baudRate: 19200 }, storage);
  const port = createPort();
  const serial = createSerial(port);
  const printer = createWebSerialPrinter({ serial, storage });

  await printer.connect();
  assert.equal(serial.requests, 1);
  assert.equal(port.openedWith.baudRate, 19200);
  assert.equal(printer.getStatus().connected, true);

  await printer.disconnect();
  assert.equal(port.closed, true);
  assert.equal(printer.getStatus().state, "disconnected");

  await printer.connect();
  assert.equal(serial.requests, 2, "reconnection must request the Chrome chooser again");
});

test("Web Serial submits fixed tests and representative synthetic sale receipts without claiming physical printing", async () => {
  const port = createPort();
  const printer = createWebSerialPrinter({ serial: createSerial(port), storage: createStorage() });
  await printer.connect();

  await printer.printTestReceipt();
  await printer.printSaleReceipt(sampleSale);
  await printer.printSaleReceipt(sampleSale);

  assert.equal(port.writes.length, 3, "a completed receipt may be explicitly reprinted");
  assert.deepEqual([...port.writes[0].slice(0, 2)], [0x1b, 0x40]);
  assert.match(new TextDecoder().decode(port.writes[0]), /JYAANO WEB SERIAL TEST/);
  assert.match(new TextDecoder().decode(port.writes[1]), /Synthetic Rice/);
  assert.match(new TextDecoder().decode(port.writes[1]), /SALE-SYNTH-001/);
  assert.equal(printer.getStatus().submission, "submitted");
  assert.match(printer.getStatus().detail, /Confirm the physical paper receipt/);
});

test("Web Serial blocks duplicate retries while a submission is pending or timed out", async () => {
  const pendingWrite = deferred();
  const port = createPort({ write: () => pendingWrite.promise });
  const printer = createWebSerialPrinter({
    serial: createSerial(port),
    storage: createStorage(),
    printTimeoutMs: 5,
  });
  await printer.connect();

  const firstPrint = printer.printSaleReceipt(sampleSale);
  await assert.rejects(printer.printSaleReceipt(sampleSale), { code: "print-job-in-progress" });
  await assert.rejects(firstPrint, { code: "print-timeout" });
  await assert.rejects(printer.printSaleReceipt(sampleSale), { code: "print-job-in-progress" });

  pendingWrite.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(printer.getStatus().submission, "submitted");
  await printer.printSaleReceipt(sampleSale);
  assert.equal(port.writes.length, 2);
});

test("Web Serial reports unavailable browsers and radio disconnections without a bridge fallback", async () => {
  const unsupported = createWebSerialPrinter({ serial: null, storage: createStorage() });
  await assert.rejects(unsupported.connect(), { code: "web-serial-unavailable" });

  const port = createPort();
  const serial = createSerial(port);
  const printer = createWebSerialPrinter({ serial, storage: createStorage() });
  await printer.connect();
  serial.disconnect();
  assert.equal(printer.getStatus().state, "disconnected");
  await assert.rejects(printer.printTestReceipt(), { code: "printer-not-connected" });
});

test("Web Serial leaves a clear recoverable status when Chrome selection is cancelled", async () => {
  const printer = createWebSerialPrinter({
    serial: {
      async requestPort() { throw new Error("The user cancelled the picker."); },
      addEventListener() {},
    },
    storage: createStorage(),
  });

  await assert.rejects(printer.connect(), { code: "connection-failed" });
  assert.equal(printer.getStatus().state, "error");
  assert.match(printer.getStatus().detail, /cancelled the picker/);
});
