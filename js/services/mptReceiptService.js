import {
  RECEIPT_BUSINESS_NAME,
  formatReceiptCurrency,
} from "./receiptService.js";
import {
  fetchPrinterBridgeStatus,
  printReceiptThroughBridge,
  testPrinterBridge,
} from "./printerBridgeService.js";
import { webSerialPrinter } from "./webSerialPrinterService.js";

function formatReceiptDateTime(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function getReceiptCashierName(sale) {
  return (
    sale.createdBy?.fullName ||
    sale.createdBy?.username ||
    sale.user ||
    "Unknown"
  );
}

function formatTaxRate(value) {
  const rate = Number(value) || 0;
  return `${rate.toFixed(1)}%`;
}

function getTaxBreakdown(sale) {
  const breakdown = sale.taxBreakdown || {};

  return {
    subtotal: Number(
      sale.subtotalAmount ?? breakdown.subtotal ?? sale.totalAmount ?? 0,
    ),

    vatRate: Number(
      breakdown.vatRate ?? sale.taxSettingsSnapshot?.vatRate ?? 0,
    ),

    nhilRate: Number(
      breakdown.nhilRate ?? sale.taxSettingsSnapshot?.nhilRate ?? 0,
    ),

    getfundRate: Number(
      breakdown.getfundRate ?? sale.taxSettingsSnapshot?.getfundRate ?? 0,
    ),

    vatAmount: Number(breakdown.vatAmount ?? 0),
    nhilAmount: Number(breakdown.nhilAmount ?? 0),
    getfundAmount: Number(breakdown.getfundAmount ?? 0),
    taxAmount: Number(breakdown.taxAmount ?? 0),

    enabled: breakdown.enabled !== false,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderReceiptItems(items = []) {
  if (items.length === 0) {
    return `<div class="mpt-empty">No items</div>`;
  }

  return items
    .map(
      (item) => `
    <div class="mpt-item">

      <div class="mpt-item-name">
        ${escapeHtml(item.name || "Item")}
      </div>

      <div class="mpt-row">
        <span>
          ${Number(item.quantity || 0)}
          ${escapeHtml(item.unitLabel || item.unit || "")}
          x ${formatReceiptCurrency(item.unitPrice)}
        </span>

        <span>
          ${formatReceiptCurrency(item.total)}
        </span>
      </div>

    </div>
  `,
    )
    .join("");
}

async function sendReceiptToMptPrinter(sale) {
  const tax = getTaxBreakdown(sale);

  const receipt = {
    businessName: RECEIPT_BUSINESS_NAME,

    businessAddress: "P. O. Box ...",
    businessPhone: "+233-000-000-0000",
    businessEmail: "kay-flowent@gmail.com",

    receiptId: sale.id,
    date: formatReceiptDateTime(sale.createdAt),
    cashier: getReceiptCashierName(sale),

    items: (sale.items || []).map((item) => ({
      name: item.name || "Item",
      quantity: Number(item.quantity || 0),
      unit: item.unitLabel || item.unit || "",
      unitPrice: Number(item.unitPrice || 0),
      total: Number(item.total || 0),
    })),

    tax: {
      enabled: tax.enabled,
      subtotal: tax.subtotal,
      nhilRate: tax.nhilRate,
      nhilAmount: tax.nhilAmount,
      getfundRate: tax.getfundRate,
      getfundAmount: tax.getfundAmount,
      vatRate: tax.vatRate,
      vatAmount: tax.vatAmount,
    },

    totalAmount: Number(sale.totalAmount || 0),
  };

  return printReceiptThroughBridge(receipt);
}

async function getPrinterStatus() {
  return fetchPrinterBridgeStatus();
}

async function runPrinterTest() {
  return testPrinterBridge();
}

function buildMptReceiptMarkup(sale, { webSerial = false } = {}) {
  const tax = getTaxBreakdown(sale);
  const printFunction = webSerial ? "printWebSerialReceipt()" : "printMptReceiptBridge()";
  const testFunction = webSerial ? "testWebSerialPrinter()" : "testMptPrinter()";
  const printerLabel = webSerial ? "Bluetooth/Web Serial Printer" : "Local Print Service";
  const printLabel = webSerial ? "Submit Bluetooth/Web Serial Receipt" : "Print MPT-II Receipt";

  return `
    <div class="mpt-receipt-page">

    <div class="mpt-printer-status">
      <div>
        Printer:
        <strong id="mptPrinterName">${printerLabel}</strong>
      </div>

      <div>
        Status:
        <strong id="mptPrinterStatus">Checking...</strong>
      </div>

      <button onclick="${testFunction}">
        Test Print
      </button>
    </div>

      <div class="mpt-receipt">

        <div class="mpt-header">
          <strong>${escapeHtml(RECEIPT_BUSINESS_NAME)}</strong>
          <div>SALES RECEIPT</div>
        </div>

        <div class="mpt-divider"></div>

        <div class="mpt-meta">
          <div>
            <span>Receipt</span>
            <span>${escapeHtml(sale.id)}</span>
          </div>

          <div>
            <span>Date</span>
            <span>${escapeHtml(formatReceiptDateTime(sale.createdAt))}</span>
          </div>

          <div>
            <span>Cashier</span>
            <span>${escapeHtml(getReceiptCashierName(sale))}</span>
          </div>
        </div>

        <div class="mpt-divider"></div>

        <div class="mpt-items">
          ${renderReceiptItems(sale.items)}
        </div>

        <div class="mpt-divider"></div>

        <div class="mpt-totals">

          ${
            tax.enabled
              ? `
            <div class="mpt-row">
              <span>Subtotal</span>
              <span>${formatReceiptCurrency(tax.subtotal)}</span>
            </div>

            <div class="mpt-row">
              <span>NHIL ${formatTaxRate(tax.nhilRate)}</span>
              <span>${formatReceiptCurrency(tax.nhilAmount)}</span>
            </div>

            <div class="mpt-row">
              <span>GETFund ${formatTaxRate(tax.getfundRate)}</span>
              <span>${formatReceiptCurrency(tax.getfundAmount)}</span>
            </div>

            <div class="mpt-row">
              <span>VAT ${formatTaxRate(tax.vatRate)}</span>
              <span>${formatReceiptCurrency(tax.vatAmount)}</span>
            </div>
          `
              : ""
          }

          <div class="mpt-row mpt-total">
            <span>TOTAL</span>
            <span>${formatReceiptCurrency(sale.totalAmount)}</span>
          </div>

        </div>

        <div class="mpt-divider"></div>

        <div class="mpt-footer">
          Thank you for your business.
        </div>

      </div>

      <div class="mpt-actions">
        <button onclick="navigate('sales')">
          Back to Sale
        </button>

        <button onclick="${printFunction}">
          ${printLabel}
        </button>
      </div>

    </div>
  `;
}

function renderThermalReceiptPage(sale, { webSerial = false } = {}) {
  const printFunctionName = webSerial ? "printWebSerialReceipt" : "printMptReceiptBridge";
  const testFunctionName = webSerial ? "testWebSerialPrinter" : "testMptPrinter";
  const printLabel = webSerial ? "Submit Bluetooth/Web Serial Receipt" : "Print MPT-II Receipt";

  window[printFunctionName] = async () => {
    try {
      const button = document.querySelector(
        `[onclick="${printFunctionName}()"]`
      );

      if (button) {
        button.disabled = true;
        button.textContent = "Printing...";
      }

      if (webSerial) {
        await webSerialPrinter.printSaleReceipt(sale);
      } else {
        await sendReceiptToMptPrinter(sale);
      }

      if (button) {
        button.textContent = webSerial ? "Bytes Submitted — Confirm Paper" : "Job Submitted";
      }

      setTimeout(() => {
        if (button) {
          button.disabled = false;
          button.textContent = printLabel;
        }
      }, 1500);
    } catch (error) {
      console.error("Receipt printing failed:", error);

      alert(
        `Unable to submit the print job (${error.code || "print-job-failed"}).\n\n${error.message}`
      );

      const button = document.querySelector(
        `[onclick="${printFunctionName}()"]`
      );

      if (button) {
        button.disabled = false;
        button.textContent = printLabel;
      }
    }
  };

  window[testFunctionName] = async () => {
    try {
      if (webSerial) {
        await webSerialPrinter.printTestReceipt();
        alert("Test bytes submitted. Confirm that a physical receipt was printed.");
      } else {
        await runPrinterTest();
        alert("Test job submitted. Confirm that a physical receipt was printed.");
      }
    } catch (error) {
      alert(
        `Printer test failed (${error.code || "print-job-failed"}).\n\n${error.message}`
      );
    }
  };

  window.app.renderPage(buildMptReceiptMarkup(sale, { webSerial }));

  setTimeout(async () => {
    const nameElement = document.getElementById(
      "mptPrinterName"
    );

    const statusElement = document.getElementById(
      "mptPrinterStatus"
    );

    try {
      const printer = webSerial ? webSerialPrinter.getStatus() : await getPrinterStatus();

      if (nameElement) {
        nameElement.textContent =
          webSerial ? "Bluetooth/Web Serial Printer" : (printer.name || "Receipt Printer");
      }

      if (statusElement) {
        statusElement.textContent =
          webSerial
            ? (printer.connected ? "Connected" : "Not connected")
            : (printer.ready ? "Ready" : "Offline");
      }
    } catch (error) {
      if (nameElement) {
        nameElement.textContent = "Receipt Printer";
      }

      if (statusElement) {
        statusElement.textContent = "Unavailable";
      }
    }
  }, 0);
}

export function renderMptReceiptPage(sale) {
  renderThermalReceiptPage(sale);
}

export function renderWebSerialReceiptPage(sale) {
  renderThermalReceiptPage(sale, { webSerial: true });
}
