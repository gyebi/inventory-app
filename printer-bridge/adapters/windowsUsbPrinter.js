const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { discoverWindowsPrinters } = require("../services/windowsPrinterDiscovery");
const {
  PRINTER_ERROR_CODES,
  createPrinterError,
  getPrinterErrorCode,
} = require("../services/printerErrors");

function parsePowerShellError(output) {
  const match = String(output || "").match(/JYAANO_PRINTER_ERROR=(\{.+\})/);

  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parsePowerShellResult(output) {
  const match = String(output || "").match(/JYAANO_PRINT_JOB=(\{.+\})/);

  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function createWindowsUsbPrinter(config, options = {}) {
  const listPrinters = typeof options.listPrinters === "function"
    ? options.listPrinters
    : discoverWindowsPrinters;
  const platform = options.platform || process.platform;
  const writeFile = options.writeFile || fs.promises.writeFile;
  const unlink = options.unlink || fs.promises.unlink;
  const runProcess = options.execFile || execFile;
  const getTempDirectory = options.tmpdir || os.tmpdir;
  const joinPath = options.joinPath || path.join;
  const scriptPath = options.scriptPath || path.join(__dirname, "..", "scripts", "printRaw.ps1");

  function getConfiguredPrinterName() {
    return String(config.printerName || "").trim();
  }

  function findConfiguredPrinter(printers = []) {
    const configuredPrinterName = getConfiguredPrinterName();

    if (!configuredPrinterName) return null;

    const normalizedConfiguredPrinterName = configuredPrinterName.toLowerCase();

    return printers.find((printer) => (
      String(printer.name || "").toLowerCase() === normalizedConfiguredPrinterName
    )) || null;
  }

  function getUnavailablePrinterError(configuredPrinter) {
    const configuredPrinterName = getConfiguredPrinterName();

    if (!configuredPrinterName) {
      return createPrinterError(
        PRINTER_ERROR_CODES.PRINTER_NOT_CONFIGURED,
        "Windows printer name is not configured"
      );
    }

    if (!configuredPrinter) {
      return createPrinterError(
        PRINTER_ERROR_CODES.PRINTER_NOT_FOUND,
        `Configured Windows printer is not installed: ${configuredPrinterName}`
      );
    }

    if (!configuredPrinter.ready || configuredPrinter.workOffline) {
      return createPrinterError(
        PRINTER_ERROR_CODES.PRINTER_OFFLINE,
        `Configured Windows printer is not ready: ${configuredPrinterName} (${configuredPrinter.printerStatus || "Offline"})`,
        { details: { printerStatus: configuredPrinter.printerStatus || "Unknown" } }
      );
    }

    return null;
  }

  function runPowerShell(printerName, tempFile) {
    return new Promise((resolve, reject) => {
      runProcess(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-PrinterName",
          printerName,
          "-FilePath",
          tempFile,
        ],
        (error, stdout, stderr) => {
          const rawError = parsePowerShellError(`${stderr}\n${stdout}`);

          if (error || rawError) {
            const message = rawError?.message || String(stderr || error?.message || "Windows print job failed").trim();
            reject(createPrinterError(
              rawError?.code || getPrinterErrorCode(error),
              message,
              { cause: error, details: rawError?.details }
            ));
            return;
          }

          resolve(parsePowerShellResult(stdout) || {});
        }
      );
    });
  }

  return {
    async getStatus() {
      const baseStatus = {
        type: "windows-usb",
        name: config.name,
        printerName: config.printerName,
        displayName: config.displayName || config.name,
        paperWidthMm: Number(config.paperWidthMm || 80),
      };

      if (platform !== "win32") {
        return {
          ...baseStatus,
          ready: false,
          errorCode: PRINTER_ERROR_CODES.UNSUPPORTED_PLATFORM,
          message: "Windows printer adapter is not running on Windows",
        };
      }

      try {
        const printers = await listPrinters();
        const configuredPrinter = findConfiguredPrinter(printers);
        const unavailableError = getUnavailablePrinterError(configuredPrinter);

        return {
          ...baseStatus,
          ready: !unavailableError,
          errorCode: unavailableError?.code || "",
          message: unavailableError?.message || "Configured printer is ready",
          availablePrinters: printers,
        };
      } catch (error) {
        return {
          ...baseStatus,
          ready: false,
          errorCode: getPrinterErrorCode(error, PRINTER_ERROR_CODES.PRINTER_DISCOVERY_FAILED),
          message: error.message || "Unable to discover Windows printers",
        };
      }
    },

    print(text, callback) {
      const printJob = async () => {
        if (platform !== "win32") {
          throw createPrinterError(
            PRINTER_ERROR_CODES.UNSUPPORTED_PLATFORM,
            "Windows USB printer adapter can only print on Windows"
          );
        }

        const printers = await listPrinters();
        const configuredPrinter = findConfiguredPrinter(printers);
        const unavailableError = getUnavailablePrinterError(configuredPrinter);

        if (unavailableError) throw unavailableError;

        const output = Buffer.concat([
          Buffer.from([0x1b, 0x40]),
          Buffer.from(text, "ascii"),
        ]);
        const tempFile = joinPath(getTempDirectory(), `inventory-receipt-${Date.now()}-${process.pid}.bin`);

        try {
          await writeFile(tempFile, output);
          const result = await runPowerShell(getConfiguredPrinterName(), tempFile);
          return { queued: true, jobId: result.jobId || null };
        } finally {
          await unlink(tempFile).catch(() => {});
        }
      };

      void printJob().then(
        (result) => callback(null, result),
        (error) => callback(error)
      );
    },
  };
}

module.exports = {
  createWindowsUsbPrinter,
  parsePowerShellError,
  parsePowerShellResult,
};
