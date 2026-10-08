const fs = require("fs");
const path = require("path");

const defaultConfig = require("../config");

const CONFIG_FILE = path.join(__dirname, "..", "printer-config.json");

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
  const type = printer.type === "windows-usb" ? "windows-usb" : "linux-rfcomm";
  const normalized = {
    type,
    name: cleanText(printer.name, defaults.name),
    displayName: cleanText(printer.displayName, cleanText(printer.name, defaults.name)),
    paperWidthMm: normalizePaperWidthMm(printer.paperWidthMm, defaults.paperWidthMm || 58),
  };

  if (type === "windows-usb") {
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

  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(mergedConfig, null, 2)}\n`, "utf8");

  return mergedConfig;
}

module.exports = {
  CONFIG_FILE,
  loadPrinterConfig,
  normalizePrinterConfig,
  savePrinterConfig,
};
