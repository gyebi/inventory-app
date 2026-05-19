import { saveSupplierPaymentToCloud } from "../services/cloudSupplierService.js";
import { createAppError, ERROR_FLAGS, logAppError, toUserMessage } from "../utils/errorUtils.js";

const CLOUD_SAVE_TIMEOUT_MS = 12000;

const {
  formatReceiptCurrency,
  navigate,
  renderPage,
  saveState,
  state
} = window.app;

const paymentMethods = [
  "Cash",
  "Mobile Money",
  "Bank Transfer",
  "Cheque",
  "Card",
  "Other"
];

function renderSupplierPayment(error = "", values = {}, success = "") {
  const supplierOptions = state.suppliers.map((supplier) => (
    `<option value="${escapeHtml(supplier.name)}">${escapeHtml(supplier.name)}</option>`
  )).join("");
  const paymentRows = renderSupplierPaymentRows();
  const defaultPaymentDate = values.paymentDate || getCurrentDateValue();

  renderPage(`
    <div class="page-title">
      <h2>Supplier Payment</h2>
      <p>Record payments made against supplier invoices or purchase references.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${success ? `<div class="message success">${success}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="paymentSupplier">Supplier</label>
        <input
          id="paymentSupplier"
          list="payment-supplier-list"
          value="${escapeHtml(values.supplier || "")}"
          oninput="updateSupplierPaymentInvoiceOptions()"
        >
        <datalist id="payment-supplier-list">${supplierOptions}</datalist>
      </div>

      <div class="form-row">
        <label for="paymentInvoiceReference">Invoice / Purchase Reference</label>
        <input
          id="paymentInvoiceReference"
          list="payment-invoice-list"
          value="${escapeHtml(values.invoiceReference || "")}"
        >
        <datalist id="payment-invoice-list">${renderInvoiceReferenceOptions(values.supplier)}</datalist>
      </div>

      <div class="form-row">
        <label for="paymentDate">Payment Date</label>
        <input id="paymentDate" type="date" value="${defaultPaymentDate}">
      </div>

      <div class="form-row">
        <label for="amountPaid">Amount Paid</label>
        <input id="amountPaid" class="number-field" type="number" min="0.01" step="0.01" value="${values.amountPaid || ""}" oninput="updateSupplierPaymentPreview()">
      </div>

      <div class="form-row">
        <label for="paymentMethod">Payment Method</label>
        <select id="paymentMethod">
          ${paymentMethods.map((method) => `
            <option value="${method}" ${values.paymentMethod === method ? "selected" : ""}>${method}</option>
          `).join("")}
        </select>
      </div>

      <div class="form-row">
        <label for="referenceNumber">Reference Number</label>
        <input id="referenceNumber" value="${escapeHtml(values.referenceNumber || "")}">
      </div>

      <div class="form-row">
        <label for="discountReceived">Discount Received</label>
        <input id="discountReceived" class="number-field" type="number" min="0" step="0.01" value="${values.discountReceived || ""}" oninput="updateSupplierPaymentPreview()">
      </div>

      <div class="form-row">
        <label for="penaltyCharge">Penalty Charge</label>
        <input id="penaltyCharge" class="number-field" type="number" min="0" step="0.01" value="${values.penaltyCharge || ""}" oninput="updateSupplierPaymentPreview()">
      </div>

      <div class="form-row">
        <label for="paymentNotes">Notes</label>
        <textarea id="paymentNotes" rows="3">${escapeHtml(values.notes || "")}</textarea>
      </div>

      <div id="supplierPaymentPreview" class="sync-panel"></div>

      <button id="saveSupplierPaymentButton" onclick="saveSupplierPayment()">Save Payment</button>
    </div>

    <h3>Recent Supplier Payments</h3>
    ${paymentRows}
  `);

  updateSupplierPaymentPreview();
}

function renderSupplierPaymentRows() {
  if (!Array.isArray(state.supplierPayments) || state.supplierPayments.length === 0) {
    return `<div class="card">No supplier payments recorded yet.</div>`;
  }

  return `
    <div class="inventory-list">
      ${state.supplierPayments
        .slice()
        .sort((left, right) => new Date(right.paymentDate || right.createdAt || 0).getTime() - new Date(left.paymentDate || left.createdAt || 0).getTime())
        .map((payment) => `
          <div class="inventory-row">
            <div><strong>Supplier:</strong> ${escapeHtml(payment.supplier || "N/A")}</div>
            <div><strong>Invoice:</strong> ${escapeHtml(payment.invoiceReference || "N/A")}</div>
            <div><strong>Date:</strong> ${formatDate(payment.paymentDate)}</div>
            <div><strong>Amount Paid:</strong> ${formatCurrency(payment.amountPaid)}</div>
            <div><strong>Method:</strong> ${escapeHtml(payment.paymentMethod || "N/A")}</div>
            <div><strong>Reference:</strong> ${escapeHtml(payment.referenceNumber || "N/A")}</div>
            <div><strong>Discount:</strong> ${formatCurrency(payment.discountReceived)}</div>
            <div><strong>Penalty:</strong> ${formatCurrency(payment.penaltyCharge)}</div>
          </div>
        `).join("")}
    </div>
  `;
}

function renderInvoiceReferenceOptions(supplier = "") {
  return getInvoiceReferencesForSupplier(supplier)
    .map((reference) => `<option value="${escapeHtml(reference)}">${escapeHtml(reference)}</option>`)
    .join("");
}

function updateSupplierPaymentInvoiceOptions() {
  const supplier = document.getElementById("paymentSupplier")?.value || "";
  const datalist = document.getElementById("payment-invoice-list");

  if (datalist) {
    datalist.innerHTML = renderInvoiceReferenceOptions(supplier);
  }

  updateSupplierPaymentPreview();
}

function updateSupplierPaymentPreview() {
  const preview = document.getElementById("supplierPaymentPreview");

  if (!preview) {
    return;
  }

  const amountPaid = Number(document.getElementById("amountPaid")?.value || 0);
  const discountReceived = Number(document.getElementById("discountReceived")?.value || 0);
  const penaltyCharge = Number(document.getElementById("penaltyCharge")?.value || 0);
  const netEffect = amountPaid + discountReceived - penaltyCharge;

  preview.innerHTML = `
    <strong>Payment Summary</strong><br>
    Amount paid: ${formatCurrency(amountPaid)}<br>
    Discount received: ${formatCurrency(discountReceived)}<br>
    Penalty charge: ${formatCurrency(penaltyCharge)}<br>
    Net reduction to payable: ${formatCurrency(netEffect)}
  `;
}

async function saveSupplierPayment() {
  const values = collectSupplierPaymentValues();

  if (!values.supplier) {
    renderSupplierPayment("Enter the supplier.", values);
    return;
  }

  if (!values.invoiceReference) {
    renderSupplierPayment("Enter the invoice or purchase reference.", values);
    return;
  }

  if (!values.paymentDate) {
    renderSupplierPayment("Enter the payment date.", values);
    return;
  }

  if (!Number.isFinite(values.amountPaid) || values.amountPaid <= 0) {
    renderSupplierPayment("Amount paid must be greater than zero.", values);
    return;
  }

  if (!values.paymentMethod) {
    renderSupplierPayment("Choose a payment method.", values);
    return;
  }

  if (values.discountReceived < 0 || values.penaltyCharge < 0) {
    renderSupplierPayment("Discount and penalty cannot be negative.", values);
    return;
  }

  const currentUser = state.user;
  const payment = {
    id: createSupplierPaymentId(),
    ...values,
    createdAt: new Date().toISOString(),
    createdBy: currentUser
      ? {
          id: currentUser.id || currentUser.uid || currentUser.email,
          fullName: currentUser.fullName || currentUser.username || currentUser.email,
          username: currentUser.username || "",
          email: currentUser.email || "",
          role: currentUser.role
        }
      : null
  };

  try {
    setSupplierPaymentProcessing(true);
    await withTimeout(
      saveSupplierPaymentToCloud(payment),
      CLOUD_SAVE_TIMEOUT_MS,
      "Firestore is taking too long to save this supplier payment. Check your internet connection and try again."
    );
  } catch (error) {
    setSupplierPaymentProcessing(false);
    logAppError("Supplier payment save failed", error);
    renderSupplierPayment(toUserMessage(error, "Unable to save supplier payment. Check your connection and try again."), values);
    return;
  }

  if (!Array.isArray(state.supplierPayments)) {
    state.supplierPayments = [];
  }

  if (!state.supplierPayments.some((item) => item.id === payment.id)) {
    state.supplierPayments.push(payment);
    saveState();
  }

  renderSupplierPayment("", {}, "Supplier payment saved successfully.");
}

function collectSupplierPaymentValues() {
  return {
    supplier: document.getElementById("paymentSupplier")?.value.trim() || "",
    invoiceReference: document.getElementById("paymentInvoiceReference")?.value.trim() || "",
    paymentDate: document.getElementById("paymentDate")?.value || "",
    amountPaid: Number(document.getElementById("amountPaid")?.value || 0),
    paymentMethod: document.getElementById("paymentMethod")?.value || "",
    referenceNumber: document.getElementById("referenceNumber")?.value.trim() || "",
    discountReceived: Number(document.getElementById("discountReceived")?.value || 0),
    penaltyCharge: Number(document.getElementById("penaltyCharge")?.value || 0),
    notes: document.getElementById("paymentNotes")?.value.trim() || ""
  };
}

function getInvoiceReferencesForSupplier(supplier = "") {
  const normalizedSupplier = supplier.trim().toLowerCase();
  const references = new Set();

  state.stockReceipts
    .filter((receipt) => !normalizedSupplier || (receipt.supplier || "").toLowerCase() === normalizedSupplier)
    .filter((receipt) => !receipt.paymentStatus || receipt.paymentStatus === "Credit")
    .forEach((receipt) => {
      const reference = receipt.invoiceNumber || receipt.invoiceDetails || receipt.purchaseId || receipt.id;

      if (reference) {
        references.add(reference);
      }
    });

  return Array.from(references).sort((left, right) => left.localeCompare(right));
}

function setSupplierPaymentProcessing(isProcessing) {
  const button = document.getElementById("saveSupplierPaymentButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving payment...`
    : "Save Payment";
}

function createSupplierPaymentId() {
  return `supplier_payment_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function getCurrentDateValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function formatCurrency(value) {
  return formatReceiptCurrency
    ? formatReceiptCurrency(value)
    : Number(value || 0).toFixed(2);
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(createAppError(message, {
      code: "firestore/save-timeout",
      source: ERROR_FLAGS.SOURCE_FIRESTORE,
      retryable: true
    })), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeout
  ]);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.renderSupplierPayment = renderSupplierPayment;
window.saveSupplierPayment = saveSupplierPayment;
window.updateSupplierPaymentInvoiceOptions = updateSupplierPaymentInvoiceOptions;
window.updateSupplierPaymentPreview = updateSupplierPaymentPreview;
