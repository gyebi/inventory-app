import {
  fetchAvailablePrinters,
  fetchPrinterBridgeStatus,
  savePrinterConfiguration,
  testPrinterBridge,
} from "../services/printerBridgeService.js";

const { renderPage } = window.app;

const printerSettingsState = {
  printerStatus: null,
  printerConfig: null,
  availablePrinters: [],
  bridgeMessage: "",
  bridgeError: "",
  loading: false,
  hasLoaded: false,
};

function getReceiptOutputMode() {
  return localStorage.getItem("receiptPrinterType") === "mpt58" ? "mpt58" : "browser";
}

function setReceiptOutputMode(mode) {
  localStorage.setItem("receiptPrinterType", mode === "mpt58" ? "mpt58" : "browser");
}

function getSelectedPrinterType() {
  return printerSettingsState.printerConfig?.type || printerSettingsState.printerStatus?.type || "linux-rfcomm";
}

function getPrinterStatusSummary() {
  if (printerSettingsState.printerStatus) {
    return {
      label: printerSettingsState.printerStatus.ready ? "Ready" : "Offline",
      detail: printerSettingsState.printerStatus.message || printerSettingsState.bridgeMessage || "Print service responded.",
      className: printerSettingsState.printerStatus.ready ? "online" : "warning",
    };
  }

  if (printerSettingsState.bridgeError) {
    return {
      label: "Service Unavailable",
      detail: printerSettingsState.bridgeError,
      className: "offline",
    };
  }

  return {
    label: "Checking...",
    detail: "Contacting the local print service.",
    className: "warning",
  };
}

function renderPrinterSettings(error = "", success = "") {
  const receiptOutputMode = getReceiptOutputMode();
  const printerStatus = printerSettingsState.printerStatus || {};
  const printerConfig = printerSettingsState.printerConfig || printerStatus;
  const selectedType = getSelectedPrinterType();
  const printerStatusSummary = getPrinterStatusSummary();
  const availablePrinters = Array.isArray(printerSettingsState.availablePrinters)
    ? printerSettingsState.availablePrinters
    : [];
  const displayName = printerConfig.displayName || printerStatus.displayName || printerStatus.name || "Receipt Printer";
  const paperWidthMm = Number(printerConfig.paperWidthMm || printerStatus.paperWidthMm || 58);
  const printerTypeName = selectedType === "windows-usb"
    ? "Windows USB"
    : "Linux RFCOMM";

  renderPage(`
    <div class="page-title">
      <h2>🖨 Printer Settings</h2>
      <p>Configure the local print service and choose whether sales print through the bridge or the browser.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${success ? `<div class="message success">${success}</div>` : ""}

    <div class="card">
      <strong>Printer</strong><br>
      ${escapeHtml(displayName)}<br>
      <strong>Connection:</strong> ${printerTypeName}<br>
      <strong>Paper:</strong> ${paperWidthMm} mm<br>
      <strong>Status:</strong> <span class="status-pill ${printerStatusSummary.className}">${escapeHtml(printerStatusSummary.label)}</span><br>
      <small class="field-hint">${escapeHtml(printerStatusSummary.detail)}</small>
    </div>

    <form class="form-column panel" onsubmit="savePrinterSettings(event)">
      <div class="form-row">
        <label for="receiptOutputMode">Receipt Output</label>
        <select id="receiptOutputMode" onchange="togglePrinterServicePanel()">
          <option value="browser" ${receiptOutputMode === "browser" ? "selected" : ""}>Browser / PDF Receipt</option>
          <option value="mpt58" ${receiptOutputMode === "mpt58" ? "selected" : ""}>Local Print Service</option>
        </select>
      </div>

      <div id="printerServicePanel" style="${receiptOutputMode === "mpt58" ? "" : "display:none;"}">
        <div class="form-row">
          <label for="printerType">Printer Type</label>
          <select id="printerType" onchange="togglePrinterTypeFields()">
            <option value="linux-rfcomm" ${selectedType === "linux-rfcomm" ? "selected" : ""}>Linux Bluetooth Printer</option>
            <option value="windows-usb" ${selectedType === "windows-usb" ? "selected" : ""}>Windows USB Printer</option>
          </select>
        </div>

        <div class="form-row">
          <label for="printerDisplayName">Display Name</label>
          <input
            id="printerDisplayName"
            value="${escapeHtml(printerConfig.displayName || printerConfig.name || printerStatus.displayName || printerStatus.name || "")}"
            placeholder="Receipt Printer"
          >
        </div>

        <div class="form-row" id="linuxPrinterFields" style="${selectedType === "linux-rfcomm" ? "" : "display:none;"}">
          <label for="linuxPrinterDevice">Linux Device Path</label>
          <input
            id="linuxPrinterDevice"
            value="${escapeHtml(printerConfig.device || printerStatus.device || "/dev/rfcomm0")}"
            placeholder="/dev/rfcomm0"
          >
        </div>

        <div class="form-row" id="windowsPrinterFields" style="${selectedType === "windows-usb" ? "" : "display:none;"}">
          <label for="windowsPrinterName">Windows Printer</label>
          <select id="windowsPrinterName">
            <option value="">Choose printer</option>
            ${availablePrinters.map((printer) => `
              <option value="${escapeHtml(printer.name)}" ${printer.name === (printerConfig.printerName || printerStatus.printerName || "") ? "selected" : ""}>
                ${escapeHtml(printer.name)}${printer.workOffline ? " (Offline)" : ""}
              </option>
            `).join("")}
          </select>
          <small class="field-hint">
            ${printerSettingsState.bridgeMessage ? escapeHtml(printerSettingsState.bridgeMessage) : "Use Refresh Printers to load available Windows printers."}
          </small>
        </div>

        <div class="form-row">
          <label for="paperWidthMm">Paper Width</label>
          <select id="paperWidthMm">
            <option value="58" ${paperWidthMm === 58 ? "selected" : ""}>58 mm</option>
            <option value="80" ${paperWidthMm === 80 ? "selected" : ""}>80 mm</option>
          </select>
        </div>
      </div>

      <div class="purchase-actions">
        <button type="button" onclick="refreshPrinterSettings()">Refresh Printers</button>
        <button type="button" onclick="testPrinterSettings()">Test Print</button>
        <button type="submit">Save Printer Settings</button>
      </div>

      <button type="button" onclick="navigate('home')">Back to Menu</button>
    </form>
  `);

  if (!printerSettingsState.hasLoaded && !printerSettingsState.loading) {
    printerSettingsState.loading = true;
    setTimeout(() => {
      void hydratePrinterSettings();
    }, 0);
  }
}

async function hydratePrinterSettings() {
  printerSettingsState.loading = true;
  printerSettingsState.bridgeError = "";
  printerSettingsState.bridgeMessage = "";

  try {
    const [statusResult, printersResult] = await Promise.allSettled([
      fetchPrinterBridgeStatus(),
      fetchAvailablePrinters(),
    ]);

    if (statusResult.status === "fulfilled") {
      printerSettingsState.printerStatus = statusResult.value;
      printerSettingsState.printerConfig = statusResult.value.config || printerSettingsState.printerConfig;
    } else {
      printerSettingsState.printerStatus = null;
      printerSettingsState.bridgeError = statusResult.reason?.message || "Receipt print service is not running.";
    }

    if (printersResult.status === "fulfilled") {
      printerSettingsState.availablePrinters = printersResult.value.printers || [];
      printerSettingsState.bridgeMessage = printersResult.value.message || "";
      printerSettingsState.printerConfig = printersResult.value.config || printerSettingsState.printerConfig;
    } else {
      printerSettingsState.availablePrinters = [];
      printerSettingsState.bridgeMessage = "";
      if (!printerSettingsState.bridgeError) {
        printerSettingsState.bridgeError = printersResult.reason?.message || "Unable to discover printers.";
      }
    }
  } catch (error) {
    printerSettingsState.printerStatus = null;
    printerSettingsState.availablePrinters = [];
    printerSettingsState.bridgeError = error.message || "Receipt print service is not running.";
  }

  printerSettingsState.loading = false;
  printerSettingsState.hasLoaded = true;

  if (window.app?.getCurrentPage?.() === "printerSettings") {
    renderPrinterSettings();
  }
}

async function refreshPrinterSettings() {
  printerSettingsState.hasLoaded = false;
  printerSettingsState.loading = true;
  renderPrinterSettings("", "Refreshing printer list...");
  await hydratePrinterSettings();
}

function togglePrinterServicePanel() {
  const receiptOutputMode = document.getElementById("receiptOutputMode")?.value || "browser";
  const servicePanel = document.getElementById("printerServicePanel");

  if (servicePanel) {
    servicePanel.style.display = receiptOutputMode === "mpt58" ? "block" : "none";
  }
}

function togglePrinterTypeFields() {
  const printerType = document.getElementById("printerType")?.value || "linux-rfcomm";
  const linuxFields = document.getElementById("linuxPrinterFields");
  const windowsFields = document.getElementById("windowsPrinterFields");

  if (linuxFields) {
    linuxFields.style.display = printerType === "linux-rfcomm" ? "block" : "none";
  }

  if (windowsFields) {
    windowsFields.style.display = printerType === "windows-usb" ? "block" : "none";
  }
}

async function savePrinterSettings(event) {
  event?.preventDefault?.();

  const receiptOutputMode = document.getElementById("receiptOutputMode")?.value || "browser";
  setReceiptOutputMode(receiptOutputMode);

  if (receiptOutputMode !== "mpt58") {
    renderPrinterSettings("", "Browser receipt mode saved.");
    return;
  }

  const printerType = document.getElementById("printerType")?.value || "linux-rfcomm";
  const printerDisplayName = document.getElementById("printerDisplayName")?.value.trim() || "";
  const paperWidthMm = Number(document.getElementById("paperWidthMm")?.value || 58);
  const printerName = document.getElementById("windowsPrinterName")?.value || "";
  const device = document.getElementById("linuxPrinterDevice")?.value.trim() || "";

  if (printerType === "windows-usb" && !printerName) {
    renderPrinterSettings("Choose a Windows printer before saving.");
    return;
  }

  if (printerType === "linux-rfcomm" && !device) {
    renderPrinterSettings("Enter the Linux device path before saving.");
    return;
  }

  const payload = {
    type: printerType,
    name: printerDisplayName || (printerType === "windows-usb" ? "Xprinter" : "MPT-II"),
    displayName: printerDisplayName || (printerType === "windows-usb" ? "Xprinter" : "MPT-II"),
    paperWidthMm,
    ...(printerType === "windows-usb"
      ? { printerName }
      : { device }),
  };

  try {
    const result = await savePrinterConfiguration(payload);
    printerSettingsState.printerStatus = result.printer || printerSettingsState.printerStatus;
    printerSettingsState.printerConfig = result.config || payload;
    printerSettingsState.bridgeMessage = "Printer configuration saved.";
    setReceiptOutputMode(receiptOutputMode);
    renderPrinterSettings("", "Printer settings saved.");
  } catch (error) {
    renderPrinterSettings(error.message || "Unable to save printer settings.");
  }
}

async function testPrinterSettings() {
  try {
    await testPrinterBridge();
    renderPrinterSettings("", "Test receipt sent to the configured printer.");
  } catch (error) {
    renderPrinterSettings(error.message || "Unable to test the printer.");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.renderPrinterSettings = renderPrinterSettings;
window.refreshPrinterSettings = refreshPrinterSettings;
window.savePrinterSettings = savePrinterSettings;
window.testPrinterSettings = testPrinterSettings;
window.togglePrinterServicePanel = togglePrinterServicePanel;
window.togglePrinterTypeFields = togglePrinterTypeFields;
