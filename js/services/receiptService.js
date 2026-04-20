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

function formatReceiptItemLine(item) {
  return `${item.name} x${item.quantity} ${item.unit}`;
}

export const generateReceiptText = (sale) => {
  const lines = [];

  lines.push(RECEIPT_BUSINESS_NAME);
  lines.push("----------------------------");

  (sale.items || []).forEach((item) => {
    lines.push(formatReceiptItemLine(item));
    lines.push(`  @ ${formatReceiptCurrency(item.unitPrice)} = ${formatReceiptCurrency(item.total)}`);
  });

  lines.push("----------------------------");
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
  return `
    <div class="page-title">
      <h2>🧾 Receipt</h2>
      <p>${RECEIPT_BUSINESS_NAME}</p>
    </div>

    <div class="card">
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
      <strong>Total:</strong> ${formatReceiptCurrency(sale.totalAmount)}
    </div>

    <button onclick="navigate('sales')">Back to Sale</button>
    <button onclick="printReceipt()">🖨 Print</button>
  `;
}

export function renderReceiptPage(sale) {
  window.app.renderPage(buildReceiptMarkup(sale));
}
