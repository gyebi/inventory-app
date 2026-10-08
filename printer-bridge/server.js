const http = require("http");

const bridgeConfig = require("./config");
const { buildReceipt } = require("./formatter/receiptFormatter");
const { createPrinter } = require("./adapters/printerFactory");
const {
  loadPrinterConfig,
  normalizePrinterConfig,
  savePrinterConfig,
} = require("./services/configStore");
const {
  discoverWindowsPrinters,
} = require("./services/windowsPrinterDiscovery");

let runtimeConfig = loadPrinterConfig();
let printer = createPrinter(runtimeConfig.printer, {
  listPrinters: discoverWindowsPrinters,
});

function getOrigin(req) {
  return req.headers.origin || "";
}

function getConfiguredOrigins() {
  const configured = String(process.env.INVENTORY_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return configured;
}

function isLocalhostOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1"
    );
  } catch (error) {
    return false;
  }
}

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }

  if (origin === "null") {
    return true;
  }

  const configuredOrigins = getConfiguredOrigins();

  if (configuredOrigins.includes(origin)) {
    return true;
  }

  return isLocalhostOrigin(origin);
}

function buildCorsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin === "null" ? "null" : origin;
  }

  return headers;
}

function sendJson(res, statusCode, body, origin = "") {
  res.writeHead(statusCode, buildCorsHeaders(origin));
  res.end(JSON.stringify(body));
}

function readJsonBody(req, callback) {
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;

    if (body.length > 100000) {
      req.destroy();
    }
  });

  req.on("end", () => {
    try {
      callback(null, JSON.parse(body || "{}"));
    } catch (error) {
      callback(error);
    }
  });
}

function refreshPrinter() {
  runtimeConfig = loadPrinterConfig();
  printer = createPrinter(runtimeConfig.printer, {
    listPrinters: discoverWindowsPrinters,
  });

  return printer;
}

function buildReceiptForPrinting(receipt) {
  return buildReceipt({
    ...receipt,
    paperWidthMm: runtimeConfig.printer.paperWidthMm,
  });
}

function printReceipt(receipt, callback) {
  const text = buildReceiptForPrinting(receipt);
  printer.print(text, callback);
}

async function getPrinterStatus() {
  const status = await Promise.resolve().then(() => printer.getStatus());

  return {
    ...status,
    displayName: status.displayName || status.name || runtimeConfig.printer.displayName || runtimeConfig.printer.name,
    paperWidthMm: Number(status.paperWidthMm || runtimeConfig.printer.paperWidthMm || 58),
  };
}

function createTestReceipt() {
  return {
    businessName: "Kay-Flo Enterprise",
    businessAddress: "P. O. Box ...",
    businessPhone: "+233-000-000-0000",
    businessEmail: "kay-flowent@gmail.com",
    receiptId: "TEST-001",
    date: new Date().toLocaleString(),
    cashier: "Test",
    items: [
      {
        name: "Inventory Print Service",
        quantity: 1,
        unit: "item",
        unitPrice: 10,
        total: 10,
      },
    ],
    tax: {
      enabled: false,
    },
    totalAmount: 10,
  };
}

async function handleGetStatus(res, origin) {
  const printerStatus = await getPrinterStatus();

  return sendJson(res, 200, {
    ok: true,
    service: {
      port: runtimeConfig.port || bridgeConfig.port,
      configFileLoaded: true,
    },
    printer: printerStatus,
    config: runtimeConfig.printer,
  }, origin);
}

async function handleListPrinters(res, origin) {
  if (process.platform !== "win32") {
    return sendJson(res, 200, {
      ok: true,
      printers: [],
      message: "Printer discovery is only available on Windows",
      selectedPrinterName: runtimeConfig.printer.printerName || "",
      config: runtimeConfig.printer,
    }, origin);
  }

  try {
    const printers = await discoverWindowsPrinters();

    return sendJson(res, 200, {
      ok: true,
      printers,
      selectedPrinterName: runtimeConfig.printer.printerName || "",
      config: runtimeConfig.printer,
    }, origin);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Unable to discover Windows printers",
    }, origin);
  }
}

async function handleConfigure(req, res, origin) {
  return readJsonBody(req, async (error, body) => {
    try {
      if (error) {
        return sendJson(res, 400, {
          ok: false,
          error: "Invalid JSON",
        }, origin);
      }

      const incoming = body.printer || body;
      const nextPrinter = normalizePrinterConfig({
        ...runtimeConfig.printer,
        ...incoming,
      });

      if (nextPrinter.type === "windows-usb" && !nextPrinter.printerName) {
        return sendJson(res, 400, {
          ok: false,
          error: "Choose a Windows printer name before saving.",
        }, origin);
      }

      if (nextPrinter.type === "linux-rfcomm" && !nextPrinter.device) {
        return sendJson(res, 400, {
          ok: false,
          error: "Choose a Linux device path before saving.",
        }, origin);
      }

      runtimeConfig = savePrinterConfig({
        printer: nextPrinter,
      });

      refreshPrinter();

      return sendJson(res, 200, {
        ok: true,
        message: "Printer configuration saved",
        config: runtimeConfig.printer,
        printer: await getPrinterStatus(),
      }, origin);
    } catch (configureError) {
      return sendJson(res, 500, {
        ok: false,
        error: configureError.message || "Unable to save printer configuration",
      }, origin);
    }
  });
}

async function handleRequest(req, res) {
  const origin = getOrigin(req);
  const requestUrl = new URL(req.url, "http://127.0.0.1");
  const pathname = requestUrl.pathname;

  if (origin && !isAllowedOrigin(origin)) {
    return sendJson(res, 403, {
      ok: false,
      error: "Origin not allowed",
    }, origin);
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, buildCorsHeaders(origin));
    return res.end();
  }

  try {
    if (req.method === "GET" && pathname === "/status") {
      return await handleGetStatus(res, origin);
    }

    if (req.method === "GET" && pathname === "/printers") {
      return await handleListPrinters(res, origin);
    }

    if (req.method === "POST" && pathname === "/configure") {
      return await handleConfigure(req, res, origin);
    }

    if (req.method === "POST" && pathname === "/test-print") {
      return printReceipt(createTestReceipt(), (error) => {
        if (error) {
          return sendJson(res, 500, {
            ok: false,
            error: error.message,
          }, origin);
        }

        return sendJson(res, 200, {
          ok: true,
          message: "Test receipt printed",
        }, origin);
      });
    }

    if (req.method === "POST" && pathname === "/print") {
      return readJsonBody(req, (error, receipt) => {
        if (error) {
          return sendJson(res, 400, {
            ok: false,
            error: "Invalid JSON",
          }, origin);
        }

        if (!receipt.receiptId || !Array.isArray(receipt.items)) {
          return sendJson(res, 400, {
            ok: false,
            error: "Invalid receipt data",
          }, origin);
        }

        printReceipt(receipt, (printError) => {
          if (printError) {
            return sendJson(res, 500, {
              ok: false,
              error: printError.message,
            }, origin);
          }

          console.log(`Receipt ${receipt.receiptId} printed`);

          return sendJson(res, 200, {
            ok: true,
            message: "Receipt printed",
          }, origin);
        });
      });
    }

    return sendJson(res, 404, {
      ok: false,
      error: "Not found",
    }, origin);
  } catch (error) {
    console.error("Printer bridge request failed:", error);
    return sendJson(res, 500, {
      ok: false,
      error: error.message || "Internal server error",
    }, origin);
  }
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(runtimeConfig.port || bridgeConfig.port, "127.0.0.1", () => {
  console.log(
    `Inventory Print Service running on http://127.0.0.1:${runtimeConfig.port || bridgeConfig.port}`
  );
});
