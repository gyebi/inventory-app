const PRINTER_BRIDGE_URL = "http://127.0.0.1:17820";

async function requestBridge(path, options = {}) {
  const response = await fetch(`${PRINTER_BRIDGE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = {};

  try {
    payload = await response.json();
  } catch (error) {
    payload = {};
  }

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.message || "Printer service request failed");
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

