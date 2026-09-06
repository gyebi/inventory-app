import {
  RECEIPT_BUSINESS_NAME,
  formatReceiptCurrency,
} from "./receiptService.js";

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
          ${escapeHtml(item.unit || "")}
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
    businessEmail: "carlkrisventures@gmail.com",

    receiptId: sale.id,
    date: formatReceiptDateTime(sale.createdAt),
    cashier: getReceiptCashierName(sale),

    items: (sale.items || []).map((item) => ({
      name: item.name || "Item",
      quantity: Number(item.quantity || 0),
      unit: item.unit || "",
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

  const response = await fetch("http://127.0.0.1:17820/print", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(receipt),
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Unable to print receipt");
  }

  return result;
}

async function getPrinterStatus() {
  const response = await fetch("http://127.0.0.1:17820/status");

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Unable to read printer status");
  }

  return result.printer;
}

async function runPrinterTest() {
  const response = await fetch("http://127.0.0.1:17820/test-print", {
    method: "POST",
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Unable to run test print");
  }

  return result;
}

function buildMptReceiptMarkup(sale) {
  const tax = getTaxBreakdown(sale);

  return `
    <div class="mpt-receipt-page">

    <div class="mpt-printer-status">
      <div>
        Printer:
        <strong id="mptPrinterName">Checking...</strong>
      </div>

      <div>
        Status:
        <strong id="mptPrinterStatus">Checking...</strong>
      </div>

      <button onclick="testMptPrinter()">
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

        <button onclick="printMptReceiptBridge()">
          Print MPT-II Receipt
        </button>
      </div>

    </div>
  `;
}

export function renderMptReceiptPage(sale) {
  window.printMptReceiptBridge = async () => {
    try {
      const button = document.querySelector(
        '[onclick="printMptReceiptBridge()"]'
      );

      if (button) {
        button.disabled = true;
        button.textContent = "Printing...";
      }

      await sendReceiptToMptPrinter(sale);

      if (button) {
        button.textContent = "Printed";
      }

      setTimeout(() => {
        if (button) {
          button.disabled = false;
          button.textContent = "Print MPT-II Receipt";
        }
      }, 1500);
    } catch (error) {
      console.error("MPT-II printing failed:", error);

      alert(
        `Unable to print receipt.\n\n${error.message}`
      );

      const button = document.querySelector(
        '[onclick="printMptReceiptBridge()"]'
      );

      if (button) {
        button.disabled = false;
        button.textContent = "Print MPT-II Receipt";
      }
    }
  };

  window.testMptPrinter = async () => {
    try {
      await runPrinterTest();
      alert("Test receipt printed successfully.");
    } catch (error) {
      alert(
        `Printer test failed.\n\n${error.message}`
      );
    }
  };

  window.app.renderPage(buildMptReceiptMarkup(sale));

  setTimeout(async () => {
    const nameElement = document.getElementById(
      "mptPrinterName"
    );

    const statusElement = document.getElementById(
      "mptPrinterStatus"
    );

    try {
      const printer = await getPrinterStatus();

      if (nameElement) {
        nameElement.textContent =
          printer.name || "Receipt Printer";
      }

      if (statusElement) {
        statusElement.textContent =
          printer.ready ? "Ready" : "Offline";
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
