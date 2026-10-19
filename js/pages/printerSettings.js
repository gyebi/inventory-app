import {
  fetchAvailablePrinters,
  fetchPrinterBridgeStatus,
  savePrinterConfiguration,
  testPrinterBridge,
} from "../services/printerBridgeService.js";
import {
  WEB_SERIAL_OUTPUT_MODE,
  getWebSerialPrinterPreferences,
  saveWebSerialPrinterPreferences,
  webSerialPrinter,
} from "../services/webSerialPrinterService.js";

import {
  ANDROID_RAWBT_OUTPUT_MODE,
  printAndroidRawBtReceipt,
} from "../services/androidRawBtPrinterService.js";

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

function describePrinterError(error, fallback) {
  const code = error?.code || "print-job-failed";
  const labels = {
    "bridge-offline": "Local print service unavailable",
    "printer-not-found": "Printer not found",
    "printer-offline": "Printer offline",
    "driver-error": "Windows driver error",
    "permission-denied": "Printer permission denied",
    "print-job-failed": "Print job failed",
  };

  return `${labels[code] || "Printer error"}: ${error?.message || fallback}`;
}

function getReceiptOutputMode() {
  const mode = localStorage.getItem("receiptPrinterType");
  return ["browser", "mpt58", WEB_SERIAL_OUTPUT_MODE, ANDROID_RAWBT_OUTPUT_MODE].includes(mode) ? mode : "browser";
}

function setReceiptOutputMode(mode) {
  localStorage.setItem(
    "receiptPrinterType",
    ["mpt58", WEB_SERIAL_OUTPUT_MODE, ANDROID_RAWBT_OUTPUT_MODE].includes(mode) ? mode : "browser",
  );
}

function getSelectedPrinterType() {
  return printerSettingsState.printerConfig?.type || printerSettingsState.printerStatus?.type || "linux-rfcomm";
}

function getWebSerialStatusLabel(status) {
  const labels = {
    connected: "Connected",
    connecting: "Waiting for permission",
    printing: "Submitting",
    uncertain: "Physical result unknown",
    unsupported: "Unavailable",
    error: "Attention needed",
    disconnected: "Not connected",
  };
  return labels[status.state] || "Not connected";
}

function getPrinterStatusSummary(receiptOutputMode) {
  if (receiptOutputMode === WEB_SERIAL_OUTPUT_MODE) {
    const status = webSerialPrinter.getStatus();
    return {
      label: getWebSerialStatusLabel(status),
      detail: status.detail,
      className: status.connected ? "online" : (status.state === "error" || status.state === "uncertain" ? "offline" : "warning"),
    };
  }

  if (printerSettingsState.printerStatus) {
    const errorLabels = {
      "printer-not-configured": "Printer Not Configured",
      "printer-not-found": "Printer Not Found",
      "printer-offline": "Printer Offline",
      "driver-error": "Driver Error",
      "permission-denied": "Permission Denied",
      "printer-discovery-failed": "Discovery Failed",
    };
    const errorCode = printerSettingsState.printerStatus.errorCode;

    return {
      label: printerSettingsState.printerStatus.ready ? "Ready" : (errorLabels[errorCode] || "Offline"),
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
  const printerStatusSummary = getPrinterStatusSummary(receiptOutputMode);
  const webSerialPreferences = getWebSerialPrinterPreferences();
  const webSerialStatus = webSerialPrinter.getStatus();
  const availablePrinters = Array.isArray(printerSettingsState.availablePrinters)
    ? printerSettingsState.availablePrinters
    : [];
  const displayName = receiptOutputMode === WEB_SERIAL_OUTPUT_MODE
    ? "Bluetooth/Web Serial Printer"
    : (printerConfig.displayName || printerStatus.displayName || printerStatus.name || "Receipt Printer");
  const paperWidthMm = receiptOutputMode === WEB_SERIAL_OUTPUT_MODE
    ? webSerialPreferences.paperWidthMm
    : Number(printerConfig.paperWidthMm || printerStatus.paperWidthMm || 58);
  const printerTypeName = receiptOutputMode === WEB_SERIAL_OUTPUT_MODE
    ? "Bluetooth / Web Serial (Chrome)"
    : selectedType === "windows-usb"
    ? "Windows Printer (USB/Bluetooth)"
    : "Linux RFCOMM";

  renderPage(`
    <div class="page-title">
      <h2>🖨 Printer Settings</h2>
      <p>Configure the local print service and choose whether sales print through the bridge or the browser.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${success ? `<div class="message success">${success}</div>` : ""}

    <div id="printerConnectionSummary" class="card" style="${receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE ? 'display:none;' : ''}">
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
          <option value="${ANDROID_RAWBT_OUTPUT_MODE}" ${receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE ? "selected" : ""}>Android / RawBT (58 mm)</option>
          <option value="browser" ${receiptOutputMode === "browser" ? "selected" : ""}>Browser / PDF Receipt</option>
          <option value="mpt58" ${receiptOutputMode === "mpt58" ? "selected" : ""}>Local Print Service</option>
          <option value="${WEB_SERIAL_OUTPUT_MODE}" ${receiptOutputMode === WEB_SERIAL_OUTPUT_MODE ? "selected" : ""}>Bluetooth / Web Serial Printer (Chrome)</option>
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

      <div id="androidRawBtPanel" style="${receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE ? "" : "display:none;"}">
        <strong>Android / RawBT</strong>
        <p>Pair your 58 mm printer and select it in RawBT once. Receipts open RawBT directly.</p>
        <button type="button" onclick="testAndroidRawBtPrinter()">Test print</button>
        <p class="field-hint">Check the paper after printing. Opening RawBT does not confirm that the printer finished.</p>
      </div>

      <div id="webSerialPrinterPanel" style="${receiptOutputMode === WEB_SERIAL_OUTPUT_MODE ? "" : "display:none;"}">
        <div class="card">
          <strong>Bluetooth / Web Serial Printer</strong><br>
          <small class="field-hint">Chrome asks an operator to choose the paired printer. Jyaano saves only safe print preferences, never a Bluetooth device identity or assumed permission. This does not use the local printer bridge.</small><br>
          <strong>Connection:</strong> <span id="webSerialStatus" class="status-pill ${webSerialStatus.connected ? "online" : "warning"}">${escapeHtml(getWebSerialStatusLabel(webSerialStatus))}</span><br>
          <small class="field-hint" id="webSerialStatusDetail">${escapeHtml(webSerialStatus.detail)}</small>
        </div>
        <div class="form-row">
          <label for="webSerialBaudRate">Baud Rate</label>
          <input id="webSerialBaudRate" type="number" min="1" value="${webSerialPreferences.baudRate}">
        </div>
        <div class="purchase-actions">
          <button type="button" onclick="connectWebSerialPrinter()">Select / reconnect printer</button>
          <button type="button" onclick="disconnectWebSerialPrinter()" ${webSerialStatus.connected ? "" : "disabled"}>Disconnect</button>
          <button type="button" onclick="testWebSerialPrinterSettings()" ${webSerialStatus.connected ? "" : "disabled"}>Send fixed test receipt</button>
        </div>
        <p class="field-hint">“Bytes submitted” means Chrome accepted the receipt bytes; confirm that paper emerged before recording a physical-print result. A timeout has an unknown physical result—do not retry it.</p>
      </div>

      <div class="purchase-actions">
        <button type="button" onclick="refreshPrinterSettings()" ${receiptOutputMode === "mpt58" ? "" : "style=\"display:none;\""}>Refresh Printers</button>
        <button type="button" onclick="testPrinterSettings()" ${receiptOutputMode === "mpt58" ? "" : "style=\"display:none;\""}>Test Print</button>
        <button type="submit">Save Printer Settings</button>
      </div>

      <button type="button" onclick="navigate('dashboard')">Back to Dashboard</button>
    </form>
  `);

  if (receiptOutputMode === "mpt58" && !printerSettingsState.hasLoaded && !printerSettingsState.loading) {
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
      printerSettingsState.bridgeError = describePrinterError(statusResult.reason, "Receipt print service is not running.");
    }

    if (printersResult.status === "fulfilled") {
      printerSettingsState.availablePrinters = printersResult.value.printers || [];
      printerSettingsState.bridgeMessage = printersResult.value.message || "";
      printerSettingsState.printerConfig = printersResult.value.config || printerSettingsState.printerConfig;
    } else {
      printerSettingsState.availablePrinters = [];
      printerSettingsState.bridgeMessage = "";
      if (!printerSettingsState.bridgeError) {
        printerSettingsState.bridgeError = describePrinterError(printersResult.reason, "Unable to discover printers.");
      }
    }
  } catch (error) {
    printerSettingsState.printerStatus = null;
    printerSettingsState.availablePrinters = [];
    printerSettingsState.bridgeError = describePrinterError(error, "Receipt print service is not running.");
  }

  printerSettingsState.loading = false;
  printerSettingsState.hasLoaded = true;

  if (window.app?.getCurrentPage?.() === "printerSettings") {
    renderPrinterSettings();
  }
}

async function refreshPrinterSettings() {
  if (getReceiptOutputMode() !== "mpt58") {
    renderPrinterSettings();
    return;
  }

  printerSettingsState.hasLoaded = false;
  printerSettingsState.loading = true;
  renderPrinterSettings("", "Refreshing printer list...");
  await hydratePrinterSettings();
}

function togglePrinterServicePanel() {
  const receiptOutputMode = document.getElementById("receiptOutputMode")?.value || "browser";
  const servicePanel = document.getElementById("printerServicePanel");
  const webSerialPanel = document.getElementById("webSerialPrinterPanel");
  const androidPanel = document.getElementById("androidRawBtPanel");
  const summary = document.getElementById("printerConnectionSummary");

  if (androidPanel) {
    androidPanel.style.display =
      receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE ? "block" : "none";
  }
  if (summary) {
    summary.style.display =
      receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE ? "none" : "block";
  }

  if (servicePanel) {
    servicePanel.style.display = receiptOutputMode === "mpt58" ? "block" : "none";
  }

  if (webSerialPanel) {
    webSerialPanel.style.display = receiptOutputMode === WEB_SERIAL_OUTPUT_MODE ? "block" : "none";
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
  if (receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE &&
      !/Android/i.test(navigator.userAgent)) {
    renderPrinterSettings("Android / RawBT requires an Android phone or tablet.");
    return;
  }
  setReceiptOutputMode(receiptOutputMode);

  if (receiptOutputMode === ANDROID_RAWBT_OUTPUT_MODE) {
    renderPrinterSettings("", "Android / RawBT receipt printing saved.");
    return;
  }

  if (receiptOutputMode === WEB_SERIAL_OUTPUT_MODE) {
    const baudRate = Number((/** @type {HTMLInputElement | null} */ (document.getElementById("webSerialBaudRate")))?.value || 0);
    if (!Number.isInteger(baudRate) || baudRate < 1) {
      renderPrinterSettings("Enter a valid Web Serial baud rate before saving.");
      return;
    }

    saveWebSerialPrinterPreferences({ baudRate, paperWidthMm: 58 });
    renderPrinterSettings("", "Bluetooth/Web Serial preference saved. Select the printer again whenever Chrome requires authorization.");
    return;
  }

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
    renderPrinterSettings(describePrinterError(error, "Unable to save printer settings."));
  }
}

async function testPrinterSettings() {
  try {
    await testPrinterBridge();
    renderPrinterSettings("", "Test job submitted. Confirm that a physical receipt was printed.");
  } catch (error) {
    renderPrinterSettings(describePrinterError(error, "Unable to test the printer."));
  }
}

async function connectWebSerialPrinter() {
  try {
    // This function is invoked directly by the operator's button click. The
    // service calls navigator.serial.requestPort() before any other await.
    await webSerialPrinter.connect();
    renderPrinterSettings("", "Bluetooth/Web Serial printer connected.");
  } catch (error) {
    renderPrinterSettings(`Bluetooth/Web Serial connection failed: ${error.message}`);
  }
}

async function disconnectWebSerialPrinter() {
  try {
    await webSerialPrinter.disconnect();
    renderPrinterSettings("", "Bluetooth/Web Serial printer disconnected.");
  } catch (error) {
    renderPrinterSettings(`Bluetooth/Web Serial disconnect failed: ${error.message}`);
  }
}

async function testWebSerialPrinterSettings() {
  try {
    await webSerialPrinter.printTestReceipt();
    renderPrinterSettings("", "Test bytes submitted. Confirm that the fixed physical test receipt emerged.");
  } catch (error) {
    renderPrinterSettings(`Bluetooth/Web Serial test failed: ${error.message}`);
  }
}

function updateWebSerialStatus() {
  const appWindow = /** @type {any} */ (window);
  if (appWindow.app?.getCurrentPage?.() !== "printerSettings" || getReceiptOutputMode() !== WEB_SERIAL_OUTPUT_MODE) return;

  const status = webSerialPrinter.getStatus();

  const statusElement = document.getElementById("webSerialStatus");
  const detailElement = document.getElementById("webSerialStatusDetail");
  if (statusElement) {
    statusElement.textContent = getWebSerialStatusLabel(status);
    statusElement.className = `status-pill ${status.connected ? "online" : (status.state === "error" || status.state === "uncertain" ? "offline" : "warning")}`;
  }
  if (detailElement) detailElement.textContent = status.detail;
}

webSerialPrinter.onStatusChange(updateWebSerialStatus);

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
const appWindow = /** @type {any} */ (window);
appWindow.connectWebSerialPrinter = connectWebSerialPrinter;
appWindow.disconnectWebSerialPrinter = disconnectWebSerialPrinter;
appWindow.testWebSerialPrinterSettings = testWebSerialPrinterSettings;

let androidTestSubmitted = false;

function testAndroidRawBtPrinter() {
  if (androidTestSubmitted &&
      !window.confirm("Print another copy of the test receipt? Check the printer first.")) {
    return;
  }
  try {
    printAndroidRawBtReceipt({
      id: "TEST-ANDROID-NOT-A-SALE",
      createdAt: new Date().toISOString(),
      createdBy: { fullName: "PRINTER TEST" },
      items: [{
        name: "TEST ONLY - NOT A SALE - Long product name wrapping check",
        quantity: 2,
        unit: "Bottle",
        unitPrice: 3,
        total: 6
      }],
      subtotalAmount: 6,
      totalAmount: 7.20,
      taxBreakdown: {
        enabled: true,
        subtotal: 6,
        vatRate: 15,
        nhilRate: 2.5,
        getfundRate: 2.5,
        vatAmount: 0.90,
        nhilAmount: 0.15,
        getfundAmount: 0.15,
        taxAmount: 1.20
      }
    });
    androidTestSubmitted = true;
  } catch (error) {
    renderPrinterSettings(error.message || "Unable to open RawBT.");
  }
}

(/** @type {any} */ (window)).testAndroidRawBtPrinter = testAndroidRawBtPrinter;
