
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { discoverWindowsPrinters } = require("../services/windowsPrinterDiscovery");

function createWindowsUsbPrinter(config, options = {}) {
  const listPrinters = typeof options.listPrinters === "function"
    ? options.listPrinters
    : discoverWindowsPrinters;

  function getPowerShell() {
    return "powershell.exe";
  }

  function getConfiguredPrinterName() {
    return String(config.printerName || "").trim();
  }

  function findConfiguredPrinter(printers = []) {
    const configuredPrinterName = getConfiguredPrinterName();

    if (!configuredPrinterName) {
      return null;
    }

    const normalizedConfiguredPrinterName = configuredPrinterName.toLowerCase();

    return printers.find((printer) => (
      String(printer.name || "").toLowerCase() === normalizedConfiguredPrinterName
    )) || null;
  }

  return {
    async getStatus() {
      if (process.platform !== "win32") {
        return {
          type: "windows-usb",
          name: config.name,
          printerName: config.printerName,
          displayName: config.displayName || config.name,
          paperWidthMm: Number(config.paperWidthMm || 80),
          ready: false,
          message: "Windows printer adapter is not running on Windows",
        };
      }

      try {
        const printers = await listPrinters();
        const configuredPrinter = findConfiguredPrinter(printers);

        return {
          type: "windows-usb",
          name: config.name,
          printerName: config.printerName,
          displayName: config.displayName || config.name,
          paperWidthMm: Number(config.paperWidthMm || 80),
          ready: Boolean(configuredPrinter && !configuredPrinter.workOffline),
          message: configuredPrinter
            ? (configuredPrinter.workOffline ? "Configured printer is offline" : "Configured printer is ready")
            : "Configured printer is not installed",
          availablePrinters: printers,
        };
      } catch (error) {
        return {
          type: "windows-usb",
          name: config.name,
          printerName: config.printerName,
          displayName: config.displayName || config.name,
          paperWidthMm: Number(config.paperWidthMm || 80),
          ready: false,
          message: error.message || "Unable to discover Windows printers",
        };
      }
    },

    print(text, callback) {
      if (process.platform !== "win32") {
        return callback(
          new Error(
            "Windows USB printer adapter can only print on Windows"
          )
        );
      }

      const configuredPrinterName = getConfiguredPrinterName();

      if (!configuredPrinterName) {
        return callback(
          new Error("Windows printer name is not configured")
        );
      }

      listPrinters()
        .then((printers) => {
          const configuredPrinter = findConfiguredPrinter(printers);

          if (!configuredPrinter) {
            throw new Error(`Configured Windows printer is not installed: ${configuredPrinterName}`);
          }

          if (configuredPrinter.workOffline) {
            throw new Error(`Configured Windows printer is offline: ${configuredPrinterName}`);
          }

          const initializePrinter = Buffer.from([0x1b, 0x40]);
          const receiptBytes = Buffer.from(text, "ascii");

          const output = Buffer.concat([
            initializePrinter,
            receiptBytes,
          ]);

          const tempFile = path.join(
            os.tmpdir(),
            `inventory-receipt-${Date.now()}.bin`
          );

          fs.writeFileSync(tempFile, output);

          const scriptPath = path.join(
            __dirname,
            "..",
            "scripts",
            "printRaw.ps1"
          );

          execFile(
            getPowerShell(),
            [
              "-NoProfile",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              scriptPath,
              "-PrinterName",
              configuredPrinterName,
              "-FilePath",
              tempFile,
            ],
            (error, stdout, stderr) => {
              fs.unlink(tempFile, () => {});

              if (error) {
                console.error(stderr || error.message);
                return callback(error);
              }

              callback(null);
            }
          );
        })
        .catch((error) => callback(error));
    },
  };
}

module.exports = {
  createWindowsUsbPrinter,
};
