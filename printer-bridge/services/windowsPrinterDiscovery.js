const { execFile } = require("child_process");

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

function normalizePrinterEntry(entry = {}) {
  const name = String(entry.Name || entry.name || "").trim();

  return {
    name,
    printerStatus: String(entry.PrinterStatus || entry.printerStatus || "Unknown"),
    workOffline: toBoolean(entry.WorkOffline ?? entry.workOffline),
    shared: toBoolean(entry.Shared ?? entry.shared),
    portName: String(entry.PortName || entry.portName || ""),
    type: String(entry.Type || entry.type || ""),
    driverName: String(entry.DriverName || entry.driverName || ""),
    ready: name.length > 0 && !toBoolean(entry.WorkOffline ?? entry.workOffline),
  };
}

function parsePrinterJson(stdout) {
  const trimmed = String(stdout || "").trim();

  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed);
  const printers = Array.isArray(parsed) ? parsed : [parsed];

  return printers
    .filter((printer) => printer && typeof printer === "object")
    .map(normalizePrinterEntry)
    .filter((printer) => printer.name.length > 0);
}

function discoverWindowsPrinters() {
  if (process.platform !== "win32") {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const script = [
      "$printers = @(Get-Printer | Select-Object Name,PrinterStatus,WorkOffline,Shared,PortName,Type,DriverName)",
      "$printers | ConvertTo-Json -Depth 3",
    ].join("; ");

    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      (error, stdout, stderr) => {
        if (error) {
          const message = String(stderr || error.message || "Unable to discover Windows printers").trim();
          reject(new Error(message));
          return;
        }

        try {
          resolve(parsePrinterJson(stdout));
        } catch (parseError) {
          reject(new Error(`Unable to parse Windows printer discovery output: ${parseError.message}`));
        }
      }
    );
  });
}

module.exports = {
  discoverWindowsPrinters,
  normalizePrinterEntry,
  parsePrinterJson,
};
