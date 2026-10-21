const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

// Shared across adapter instances, including after configuration reloads.
let submissionInProgress = false;
const ALLOWED_BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

function printerError(code, message) {
  return Object.assign(new Error(message), { code });
}

function readMarker(output, marker) {
  const line = String(output || "").split(/\r?\n/)
    .find((entry) => entry.startsWith(marker));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(marker.length));
  } catch {
    return null;
  }
}

function createWindowsBluetoothPrinter(config, options = {}) {
  const platform = options.platform || process.platform;
  const runProcess = options.execFile || execFile;
  const portName = String(config.portName || "").trim().toUpperCase();
  const baudRate = Number(config.baudRate ?? 9600);
  const scriptPath = path.join(__dirname, "..", "scripts", "printBluetooth.ps1");

  function validate() {
    if (platform !== "win32") {
      throw printerError("unsupported-platform", "Bluetooth helper requires Windows.");
    }
    if (!/^COM[1-9][0-9]{0,3}$/.test(portName)) {
      throw printerError("printer-not-configured", "Select an outgoing Bluetooth COM port.");
    }
    if (!ALLOWED_BAUD_RATES.includes(baudRate)) {
      throw printerError("printer-not-configured", "Unsupported serial baud rate.");
    }
  }

  function submit(filePath) {
    return new Promise((resolve, reject) => {
      runProcess("powershell.exe", [
        "-NoProfile", "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
        "-PortName", portName,
        "-BaudRate", String(baudRate),
        "-FilePath", filePath,
      ], {
        windowsHide: true,
        timeout: 20000,
        killSignal: "SIGKILL",
        maxBuffer: 65536,
      }, (error, stdout, stderr) => {
        const failure = readMarker(
          `${stderr || ""}\n${stdout || ""}`,
          "JYAANO_PRINTER_ERROR="
        );

        if (failure) {
          const unknown = failure.submissionStarted === true;
          reject(printerError(
            unknown ? "print-result-unknown" : "print-job-failed",
            unknown
              ? "Print result unknown. Check the paper before any manual reprint."
              : String(failure.message || "Unable to submit receipt.")
          ));
          return;
        }

        if (error) {
          // An interrupted process may already have sent some or all bytes.
          reject(printerError(
            error.code === "ENOENT" ? "print-job-failed" : "print-result-unknown",
            error.code === "ENOENT"
              ? "Windows PowerShell could not be started."
              : "Print result unknown. Check the paper; do not automatically retry."
          ));
          return;
        }

        const result = readMarker(stdout, "JYAANO_PRINT_JOB=");
        if (result?.submitted !== true) {
          reject(printerError(
            "print-result-unknown",
            "No reliable submission response. Check the physical receipt."
          ));
          return;
        }

        resolve({ submitted: true, physicalPrintConfirmed: false });
      });
    });
  }

  async function printJob(text) {
    validate();
    if (submissionInProgress) {
      throw printerError("print-job-in-progress", "A receipt is already being submitted.");
    }
    if (typeof text !== "string" || text.length > 65500) {
      throw printerError("print-job-failed", "Receipt is invalid or too large.");
    }

    // Receipt content cannot inject ESC/POS commands.
    const cleanText = Array.from(text, (character) => {
      const code = character.charCodeAt(0);
      if (code === 10 || code === 13 || code === 9) return character;
      if (code < 32 || code === 127) return "";
      return code <= 126 ? character : "?";
    }).join("").replace(/\s+$/, "");

    if (!cleanText.trim()) {
      throw printerError("print-job-failed", "Receipt is empty.");
    }

    const bytes = Buffer.concat([
      Buffer.from([27, 64]),
      Buffer.from(`${cleanText}\n\n\n`, "ascii"),
    ]);
    submissionInProgress = true;
    let directory;

    try {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "jyaano-print-"));
      const filePath = path.join(directory, "receipt.bin");
      await fs.writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
      return await submit(filePath);
    } finally {
      if (directory) {
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      }
      submissionInProgress = false;
    }
  }

  return {
    getStatus() {
      let validationError = null;
      try { validate(); } catch (error) { validationError = error; }
      return {
        type: "windows-bluetooth",
        name: config.name || "MPT-II",
        displayName: config.displayName || config.name || "MPT-II",
        portName,
        baudRate,
        paperWidthMm: 58,
        ready: false,
        configured: !validationError,
        errorCode: validationError?.code || "",
        message: validationError?.message ||
          "Port configured. Send a test and confirm the physical receipt.",
      };
    },
    print(text, callback) {
      void printJob(text).then(
        (result) => callback(null, result),
        (error) => callback(error)
      );
    },
  };
}

module.exports = { createWindowsBluetoothPrinter };
