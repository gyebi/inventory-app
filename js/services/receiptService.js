export const RECEIPT_BUSINESS_NAME = "CALKRIS-DARF VENTURES";

export function formatReceiptCurrency(value) {
  const amount = Number(value) || 0;
  return `Ghs ${amount.toFixed(2)}`;
}

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
  return sale.createdBy?.fullName || sale.createdBy?.username || sale.user || "Unknown";
}

function formatTaxRate(value) {
  const rate = Number(value) || 0;
  return `${rate.toFixed(1)}%`;
}

function getTaxBreakdown(sale) {
  const breakdown = sale.taxBreakdown || {};

  return {
    subtotal: Number(sale.subtotalAmount ?? breakdown.subtotal ?? sale.totalAmount ?? 0),
    vatRate: Number(breakdown.vatRate ?? sale.taxSettingsSnapshot?.vatRate ?? 0),
    nhilRate: Number(breakdown.nhilRate ?? sale.taxSettingsSnapshot?.nhilRate ?? 0),
    getfundRate: Number(breakdown.getfundRate ?? sale.taxSettingsSnapshot?.getfundRate ?? 0),
    vatAmount: Number(breakdown.vatAmount ?? 0),
    nhilAmount: Number(breakdown.nhilAmount ?? 0),
    getfundAmount: Number(breakdown.getfundAmount ?? 0),
    taxAmount: Number(breakdown.taxAmount ?? 0),
    totalAmount: Number(breakdown.totalAmount ?? sale.totalAmount ?? 0),
    enabled: breakdown.enabled !== false
  };
}

function formatReceiptItemLine(item) {
  return `${item.name} x${item.quantity} ${item.unit}`;
}

export const generateReceiptText = (sale) => {
  const lines = [];
  const tax = getTaxBreakdown(sale);

  lines.push(RECEIPT_BUSINESS_NAME);
  lines.push("----------------------------");

  (sale.items || []).forEach((item) => {
    lines.push(formatReceiptItemLine(item));
    lines.push(`  @ ${formatReceiptCurrency(item.unitPrice)} = ${formatReceiptCurrency(item.total)}`);
  });

  lines.push("----------------------------");
  if (tax.enabled) {
    lines.push(`SUBTOTAL: ${formatReceiptCurrency(tax.subtotal)}`);
    lines.push(`NHIL (${formatTaxRate(tax.nhilRate)}): ${formatReceiptCurrency(tax.nhilAmount)}`);
    lines.push(`GETFund (${formatTaxRate(tax.getfundRate)}): ${formatReceiptCurrency(tax.getfundAmount)}`);
    lines.push(`VAT (${formatTaxRate(tax.vatRate)}): ${formatReceiptCurrency(tax.vatAmount)}`);
  }
  lines.push(`TOTAL: ${formatReceiptCurrency(sale.totalAmount)}`);
  lines.push(`DATE: ${formatReceiptDateTime(sale.createdAt)}`);
  lines.push(`RECEIPT ID: ${sale.id}`);
  lines.push(`SERVED BY: ${getReceiptCashierName(sale)}`);

  return lines.join("\n");
};
function getReceiptItemsMarkup(items = []) {
  if (items.length === 0) {
    return `
      <tr>
        <td colspan="4">No items on this receipt.</td>
      </tr>
    `;
  }

  return items.map((item) => `
    <tr>
      <td>${formatReceiptItemLine(item)}</td>
      <td>${item.quantity} ${item.unit}</td>
      <td>${formatReceiptCurrency(item.unitPrice)}</td>
      <td>${formatReceiptCurrency(item.total)}</td>
    </tr>
  `).join("");
}

function buildReceiptMarkup(sale) {
  const tax = getTaxBreakdown(sale);
  return `
    <div class="receipt-page">
      <div class="page-title">
        <h2>🧾 Receipt</h2>
        <p>${RECEIPT_BUSINESS_NAME}</p>
      </div>

      <div class="card receipt-card">
        <strong>Business Name:</strong> ${RECEIPT_BUSINESS_NAME}<br>
        <strong>Receipt ID:</strong> ${sale.id}<br>
        <strong>Date/Time:</strong> ${formatReceiptDateTime(sale.createdAt)}<br>
        <strong>Cashier:</strong> ${getReceiptCashierName(sale)}<br>
        <hr>
        <table class="receipt-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${getReceiptItemsMarkup(sale.items)}
          </tbody>
        </table>
        <hr>
        ${tax.enabled ? `
          <strong>Subtotal:</strong> ${formatReceiptCurrency(tax.subtotal)}<br>
          <strong>NHIL (${formatTaxRate(tax.nhilRate)}):</strong> ${formatReceiptCurrency(tax.nhilAmount)}<br>
          <strong>GETFund (${formatTaxRate(tax.getfundRate)}):</strong> ${formatReceiptCurrency(tax.getfundAmount)}<br>
          <strong>VAT (${formatTaxRate(tax.vatRate)}):</strong> ${formatReceiptCurrency(tax.vatAmount)}<br>
          <strong>Total Tax:</strong> ${formatReceiptCurrency(tax.taxAmount)}<br>
        ` : ""}
        <strong>Total:</strong> ${formatReceiptCurrency(sale.totalAmount)}
      </div>

      <div class="receipt-actions">
        <button onclick="navigate('sales')">Back to Sale</button>
        <button onclick="printReceipt()">🖨 Print</button>
      </div>
    </div>
  `;
}

export function renderReceiptPage(sale) {
  window.app.renderPage(buildReceiptMarkup(sale));
}
