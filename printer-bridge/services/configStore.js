const fs = require("fs");
const path = require("path");

const defaultConfig = require("../config");

const os = require("node:os");
const { randomUUID } = require("node:crypto");

const CONFIG_FILE = process.platform === "win32"
  ? path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "JyaanoPrintHelper",
      "printer-config.json"
    )
  : path.join(__dirname, "..", "printer-config.json");

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(defaultConfig));
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();

  return text.length > 0 ? text : fallback;
}

function normalizePaperWidthMm(value, fallback = 58) {
  const paperWidthMm = Number(value);

  if (paperWidthMm === 80) {
    return 80;
  }

  if (paperWidthMm === 58) {
    return 58;
  }

  return fallback;
}

function normalizePrinterConfig(printer = {}) {
  const defaults = cloneDefaultConfig().printer;
  const type = printer.type === "windows-bluetooth"
    ? "windows-bluetooth"
    : printer.type === "windows-usb" ? "windows-usb" : "linux-rfcomm";
  const normalized = {
    type,
    name: cleanText(printer.name, defaults.name),
    displayName: cleanText(printer.displayName, cleanText(printer.name, defaults.name)),
    paperWidthMm: normalizePaperWidthMm(printer.paperWidthMm, defaults.paperWidthMm || 58),
  };

  if (type === "windows-bluetooth") {
    const portName = cleanText(printer.portName).toUpperCase();
    const baudRate = Number(printer.baudRate ?? 9600);
    if (!/^COM[1-9][0-9]{0,3}$/.test(portName)) {
      throw new Error("Choose a valid outgoing Bluetooth COM port.");
    }
    if (![9600, 19200, 38400, 57600, 115200].includes(baudRate)) {
      throw new Error("Unsupported Bluetooth baud rate.");
    }
    normalized.portName = portName;
    normalized.baudRate = baudRate;
    normalized.paperWidthMm = 58;
  } else if (type === "windows-usb") {
    normalized.printerName = cleanText(printer.printerName, "");
  } else {
    normalized.device = cleanText(printer.device, defaults.device);
  }

  return normalized;
}

function normalizeStoredConfig(storedConfig = {}) {
  const defaults = cloneDefaultConfig();

  return {
    port: Number(storedConfig.port || defaults.port || 17820),
    printer: normalizePrinterConfig(storedConfig.printer || storedConfig),
  };
}

function readStoredConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.error("Unable to read printer config:", error.message);
    return null;
  }
}

function loadPrinterConfig() {
  const storedConfig = readStoredConfig();

  if (!storedConfig) {
    return cloneDefaultConfig();
  }

  return normalizeStoredConfig(storedConfig);
}

function savePrinterConfig(nextConfig = {}) {
  const currentConfig = loadPrinterConfig();
  const mergedConfig = normalizeStoredConfig({
    ...currentConfig,
    ...nextConfig,
    printer: {
      ...(currentConfig.printer || {}),
      ...(nextConfig.printer || nextConfig),
    },
  });

  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const temporaryFile = `${CONFIG_FILE}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(
      temporaryFile,
      `${JSON.stringify(mergedConfig, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
    fs.renameSync(temporaryFile, CONFIG_FILE);
  } finally {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }

  return mergedConfig;
}

module.exports = {
  CONFIG_FILE,
  loadPrinterConfig,
  normalizePrinterConfig,
  savePrinterConfig,
};
