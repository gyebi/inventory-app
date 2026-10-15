const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createWindowsUsbPrinter,
  parsePowerShellError,
  parsePowerShellResult,
} = require("../adapters/windowsUsbPrinter");
const {
  normalizePrinterEntry,
  discoverWindowsPrinters,
} = require("../services/windowsPrinterDiscovery");

const config = {
  type: "windows-usb",
  name: "Receipt Printer",
  printerName: "XP-80C",
  paperWidthMm: 80,
};

function print(printer, text = "receipt") {
  return new Promise((resolve, reject) => {
    printer.print(text, (error, result) => error ? reject(error) : resolve(result));
  });
}

function readyPrinter(overrides = {}) {
  return {
    name: "XP-80C",
    ready: true,
    workOffline: false,
    printerStatus: "Normal",
    ...overrides,
  };
}

test("Windows adapter reports a missing configured printer without launching PowerShell", async () => {
  let commandStarted = false;
  const printer = createWindowsUsbPrinter(config, {
    platform: "win32",
    listPrinters: async () => [],
    execFile: () => {
      commandStarted = true;
    },
  });

  await assert.rejects(print(printer), { code: "printer-not-found" });
  assert.equal(commandStarted, false);
});

test("Windows adapter preserves structured driver and permission errors from the raw print helper", async () => {
  const printer = createWindowsUsbPrinter(config, {
    platform: "win32",
    listPrinters: async () => [readyPrinter()],
    writeFile: async () => {},
    unlink: async () => {},
    tmpdir: () => "C:/Temp",
    execFile: (_command, _arguments, callback) => callback(
      Object.assign(new Error("PowerShell failed"), { code: 1 }),
      "",
      "JYAANO_PRINTER_ERROR={\"code\":\"driver-error\",\"message\":\"Windows print job failed at StartDocPrinter.\",\"details\":{\"win32Error\":1797}}"
    ),
  });

  await assert.rejects(print(printer), (error) => {
    assert.equal(error.code, "driver-error");
    assert.equal(error.details.win32Error, 1797);
    return true;
  });
});

test("Windows adapter reports a queued spooler job and removes its temporary receipt", async () => {
  let temporaryFile = "";
  let removedFile = "";
  const printer = createWindowsUsbPrinter(config, {
    platform: "win32",
    listPrinters: async () => [readyPrinter()],
    writeFile: async (file, data) => {
      temporaryFile = file;
      assert.equal(data[0], 0x1b);
    },
    unlink: async (file) => {
      removedFile = file;
    },
    tmpdir: () => "C:/Temp",
    joinPath: (_directory, filename) => `C:/Temp/${filename}`,
    execFile: (_command, _arguments, callback) => callback(null, "JYAANO_PRINT_JOB={\"jobId\":42}\n", ""),
  });

  assert.deepEqual(await print(printer), { queued: true, jobId: 42 });
  assert.match(temporaryFile, /^C:\/Temp\/inventory-receipt-/);
  assert.equal(removedFile, temporaryFile);
});

test("Windows printer discovery treats paused and offline queues as unavailable", () => {
  assert.equal(normalizePrinterEntry({ Name: "XP-80C", PrinterStatus: "Paused", WorkOffline: false }).ready, false);
  assert.equal(normalizePrinterEntry({ Name: "XP-80C", PrinterStatus: "Normal", WorkOffline: true }).ready, false);
  assert.equal(normalizePrinterEntry({ Name: "XP-80C", PrinterStatus: "Normal", WorkOffline: false }).ready, true);
});

test("Windows printer discovery returns a permission error when PowerShell is denied", async () => {
  await assert.rejects(
    discoverWindowsPrinters({
      platform: "win32",
      execFile: (_command, _arguments, callback) => callback(new Error("Access is denied"), "", "Access is denied"),
    }),
    { code: "permission-denied" }
  );
});

test("PowerShell bridge output parsers only accept their structured markers", () => {
  assert.deepEqual(parsePowerShellResult("JYAANO_PRINT_JOB={\"jobId\":7}"), { jobId: 7 });
  assert.deepEqual(parsePowerShellError("JYAANO_PRINTER_ERROR={\"code\":\"permission-denied\"}"), {
    code: "permission-denied",
  });
  assert.equal(parsePowerShellError("unstructured failure"), null);
});
