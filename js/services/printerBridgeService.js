const PRINTER_BRIDGE_URL = "http://127.0.0.1:17820";

export const PRINTER_BRIDGE_ERROR_CODES = Object.freeze({
  BRIDGE_OFFLINE: "bridge-offline",
  PRINTER_NOT_CONFIGURED: "printer-not-configured",
  PRINTER_NOT_FOUND: "printer-not-found",
  PRINTER_OFFLINE: "printer-offline",
  DRIVER_ERROR: "driver-error",
  PERMISSION_DENIED: "permission-denied",
  PRINT_JOB_FAILED: "print-job-failed",
  PRINTER_DISCOVERY_FAILED: "printer-discovery-failed",
});

function createBridgeError(message, code, details) {
  return Object.assign(new Error(message), { code, details });
}

async function requestBridge(path, options = {}) {
  let response;

  try {
    response = await fetch(`${PRINTER_BRIDGE_URL}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch (error) {
    throw createBridgeError(
      "The local print service is unavailable. Start the printer bridge on this computer and check browser local-network permissions.",
      PRINTER_BRIDGE_ERROR_CODES.BRIDGE_OFFLINE,
      { cause: error?.message || "Network request failed" }
    );
  }

  let payload = {};

  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    throw createBridgeError(
      payload.error || payload.message || "Printer service request failed",
      payload.errorCode || "print-job-failed",
      payload.details
    );
  }

  return payload;
}

export async function fetchPrinterBridgeStatus() {
  const result = await requestBridge("/status");
  return result.printer || null;
}

export async function fetchAvailablePrinters() {
  const result = await requestBridge("/printers");

  return {
    printers: Array.isArray(result.printers) ? result.printers : [],
    message: result.message || "",
    selectedPrinterName: result.selectedPrinterName || "",
    config: result.config || null,
  };
}

export async function savePrinterConfiguration(printer) {
  return requestBridge("/configure", {
    method: "POST",
    body: JSON.stringify({
      printer,
    }),
  });
}

export async function testPrinterBridge() {
  return requestBridge("/test-print", {
    method: "POST",
  });
}

export async function printReceiptThroughBridge(receipt) {
  return requestBridge("/print", {
    method: "POST",
    body: JSON.stringify(receipt),
  });
}
