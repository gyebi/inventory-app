import { generateReceiptText } from "./receiptService.js";

export const WEB_SERIAL_OUTPUT_MODE = "web-serial";
export const WEB_SERIAL_PREFERENCES_KEY = "webSerialPrinterPreferences";

const DEFAULT_PREFERENCES = Object.freeze({
  baudRate: 9600,
  paperWidthMm: 58,
});

function createWebSerialError(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function normalisePreferences(value = {}) {
  const baudRate = Number(value.baudRate);
  const paperWidthMm = Number(value.paperWidthMm);

  return {
    baudRate: Number.isInteger(baudRate) && baudRate > 0 ? baudRate : DEFAULT_PREFERENCES.baudRate,
    paperWidthMm: paperWidthMm === 80 ? 80 : DEFAULT_PREFERENCES.paperWidthMm,
  };
}

function getStorage(storage = globalThis.localStorage) {
  return storage && typeof storage.getItem === "function" ? storage : null;
}

export function getWebSerialPrinterPreferences(storage) {
  const safeStorage = getStorage(storage);
  if (!safeStorage) return { ...DEFAULT_PREFERENCES };

  try {
    return normalisePreferences(JSON.parse(safeStorage.getItem(WEB_SERIAL_PREFERENCES_KEY) || "{}"));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveWebSerialPrinterPreferences(preferences, storage) {
  const safeStorage = getStorage(storage);
  const saved = normalisePreferences(preferences);

  if (safeStorage) {
    safeStorage.setItem(WEB_SERIAL_PREFERENCES_KEY, JSON.stringify(saved));
  }

  return saved;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createWebSerialError("print-timeout", message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function createTestReceiptText() {
  return [
    "JYAANO WEB SERIAL TEST",
    "MPT-II / 58 mm candidate",
    "This is a printer test only.",
    "No sale was recorded.",
  ].join("\n");
}

/**
 * Browser-only serial transport. A port is intentionally held only in memory:
 * preference storage never contains a port id, Bluetooth address, or permission
 * claim. Every connection asks Chrome to show its user-authorized chooser.
 */
export function createWebSerialPrinter({
  serial = /** @type {any} */ (globalThis.navigator)?.serial,
  storage = globalThis.localStorage,
  encode = (text) => new TextEncoder().encode(text),
  printTimeoutMs = 15000,
} = {}) {
  let port = null;
  let activePrintJob = null;
  let disconnectListenerAttached = false;
  let status = {
    state: serial ? "disconnected" : "unsupported",
    detail: serial
      ? "No Bluetooth/Web Serial printer selected."
      : "Web Serial is unavailable. Use Chrome on a supported desktop platform.",
    submission: "none",
  };
  const listeners = new Set();

  function publish(next) {
    status = { ...status, ...next };
    listeners.forEach((listener) => listener({ ...status }));
  }

  function ensureSupported() {
    if (!serial || typeof serial.requestPort !== "function") {
      throw createWebSerialError(
        "web-serial-unavailable",
        "Web Serial is unavailable. Use Chrome on a supported desktop platform.",
      );
    }
  }

  async function closePort(openPort) {
    if (!openPort) return;

    if (port === openPort) {
      port = null;
    }

    try {
      await openPort.close();
    } catch {
      // A radio/range loss can close the port before the application does.
    }
  }

  function attachDisconnectListener() {
    if (disconnectListenerAttached || !serial?.addEventListener) return;

    serial.addEventListener("disconnect", (event) => {
      if (event.target === port) {
        port = null;
        publish({
          state: "disconnected",
          detail: "Printer disconnected. Select the printer again before submitting another receipt.",
          submission: activePrintJob ? "unknown" : status.submission,
        });
      }
    });
    disconnectListenerAttached = true;
  }

  async function connect() {
    ensureSupported();

    if (activePrintJob) {
      throw createWebSerialError("print-job-in-progress", "Wait for the current print submission before changing the connection.");
    }

    if (port?.writable) {
      throw createWebSerialError("printer-already-connected", "Disconnect the current printer before selecting another one.");
    }

    publish({ state: "connecting", detail: "Choose the paired printer in Chrome's permission picker.", submission: "none" });

    // Keep requestPort as the first awaited operation. Call connect directly from
    // a trusted click handler; do not use getPorts() or auto-reconnect.
    let selectedPort;

    try {
      selectedPort = await serial.requestPort();
      const preferences = getWebSerialPrinterPreferences(storage);
      await selectedPort.open({
        baudRate: preferences.baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });
      port = selectedPort;
      attachDisconnectListener();
      publish({
        state: "connected",
        detail: "Connected. The printer can disconnect at any time; select it again if Chrome requests permission.",
        submission: "none",
      });
      return getStatus();
    } catch (error) {
      await closePort(selectedPort);
      publish({ state: "error", detail: `Connection failed: ${error.message}`, submission: "none" });
      throw createWebSerialError("connection-failed", error.message, { cause: error });
    }
  }

  async function disconnect() {
    if (activePrintJob && status.state !== "uncertain") {
      throw createWebSerialError("print-job-in-progress", "A print submission is still active. Do not disconnect and retry it.");
    }

    await closePort(port);
    publish({
      state: "disconnected",
      detail: activePrintJob
        ? "Disconnected while the timed-out submission remains unresolved. Do not retry that receipt."
        : "Disconnected. Use Select / reconnect printer when ready.",
      submission: activePrintJob ? "unknown" : "none",
    });
  }

  async function submitText(text, label = "receipt") {
    if (activePrintJob) {
      throw createWebSerialError("print-job-in-progress", "A receipt is already being submitted. Do not retry; wait for its result or reconnect the printer.");
    }

    if (!port?.writable) {
      throw createWebSerialError("printer-not-connected", "Select and connect a Bluetooth/Web Serial printer first.");
    }

    const writer = port.writable.getWriter();
    const payload = new Uint8Array([
      0x1b, 0x40,
      ...encode(`${text}\n\n\n`),
    ]);
    const job = {
      label,
      submittedAt: new Date().toISOString(),
      promise: null,
    };
    activePrintJob = job;
    publish({ state: "printing", detail: `Submitting ${label} bytes to the printer…`, submission: "pending" });

    const writePromise = writer.write(payload)
      .then(() => {
        publish({
          state: "connected",
          detail: "Receipt bytes submitted. Confirm the physical paper receipt before treating it as printed.",
          submission: "submitted",
        });
        return { status: "submitted", submittedAt: job.submittedAt };
      })
      .catch((error) => {
        publish({ state: "error", detail: `Printer submission failed: ${error.message}`, submission: "failed" });
        throw createWebSerialError("print-job-failed", error.message, { cause: error });
      })
      .finally(() => {
        writer.releaseLock();
        if (activePrintJob === job) activePrintJob = null;
      });
    job.promise = writePromise;

    try {
      return await withTimeout(
        writePromise,
        printTimeoutMs,
        "Printer submission timed out. Its physical result is unknown; do not retry this receipt. Disconnect or wait for the pending submission to finish.",
      );
    } catch (error) {
      if (error.code === "print-timeout") {
        publish({
          state: "uncertain",
          detail: error.message,
          submission: "unknown",
        });
      }
      throw error;
    }
  }

  function printSaleReceipt(sale) {
    return submitText(generateReceiptText(sale), `receipt ${sale?.id || ""}`.trim());
  }

  function printTestReceipt() {
    return submitText(createTestReceiptText(), "test receipt");
  }

  function getStatus() {
    return { ...status, connected: Boolean(port?.writable), printing: Boolean(activePrintJob) };
  }

  return {
    connect,
    disconnect,
    getStatus,
    isSupported: () => Boolean(serial?.requestPort),
    onStatusChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    printSaleReceipt,
    printTestReceipt,
  };
}

export const webSerialPrinter = createWebSerialPrinter();
