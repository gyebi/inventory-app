const { execFile } = require("node:child_process");
const { createPrinterError } = require("./printerErrors");

function parseSerialPorts(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return [];

  const parsed = JSON.parse(text);
  const entries = Array.isArray(parsed) ? parsed : [parsed];

  return [...new Set(entries
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^COM[1-9][0-9]{0,3}$/.test(value))
  )]
    .sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)))
    .map((portName) => ({
      portName,
      label: portName,
      direction: "unknown",
    }));
}

function discoverWindowsSerialPorts(options = {}) {
  const platform = options.platform || process.platform;
  const runProcess = options.execFile || execFile;

  if (platform !== "win32") return Promise.resolve([]);

  return new Promise((resolve, reject) => {
    runProcess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "ConvertTo-Json -InputObject @([System.IO.Ports.SerialPort]::GetPortNames()) -Compress",
    ], {
      windowsHide: true,
      timeout: 5000,
      killSignal: "SIGKILL",
      maxBuffer: 16384,
    }, (error, stdout) => {
      if (error) {
        reject(createPrinterError(
          "printer-discovery-failed",
          "Unable to list Windows COM ports. Check Bluetooth pairing and try Refresh.",
          { cause: error }
        ));
        return;
      }

      try {
        resolve(parseSerialPorts(stdout));
      } catch (error) {
        reject(createPrinterError(
          "printer-discovery-failed",
          "Windows returned an invalid COM-port list.",
          { cause: error }
        ));
      }
    });
  });
}

module.exports = { discoverWindowsSerialPorts, parseSerialPorts };
