import { renderReceiptPage } from "../services/receiptService.js";
import { createSale, getCheckoutConfirmation } from "../services/salesService.js";
import { getUnresolvedSecureCheckout } from "../services/secureCheckoutService.js";
import { logAppError, toUserMessage } from "../utils/errorUtils.js";
import { hasPermission } from "../services/authService.js";
import { fetchPrinterBridgeStatus } from "../services/printerBridgeService.js";

import { renderMptReceiptPage, renderWebSerialReceiptPage } from "../services/mptReceiptService.js";

const app = /** @type {any} */ (window).app;
const { ensureStockState, renderPage, state } = app;
let saleCart = [];
let selectedProductId = "";
let selectedSaleUnit = "bulk";
let selectedSalePaymentMethod = "Cash";
let posPrinterStatus = { checked: false, loading: false, ready: null, message: "" };
let saleSubmissionInFlight = false;
let pendingCheckoutQuote = null;

function formatSaleStock(product) {
  return app.formatStock(product);
}

function getCommittedBaseQuantity(product) {
  return Number(product?.quantity || 0);
}

function getProductUnitLabel(product, saleUnit = "bulk") {
  if (!product) {
    return saleUnit;
  }

  return saleUnit === "base"
    ? (product.baseUnit || "base unit")
    : (product.bulkUnit || "bulk unit");
}

function getSaleUnitPrice(product, saleUnit = "bulk") {
  if (!product) {
    return 0;
  }

  // Approved v2 prices are stored in pesewas; legacy prices are in cedis.
  if (product.inventorySchemaVersion === 2 && product.pricingStatus === "approved") {
    const base = product.sellingPricePesewas;
    const conversion = product.unitsPerBulk;
    const explicitBulk = product.bulkSellingPricePesewas;
    const baseValid = Number.isSafeInteger(base) && base > 0;
    const conversionValid = Number.isSafeInteger(conversion) && conversion > 0;
    const bulk = explicitBulk == null
      ? (baseValid && conversionValid ? base * conversion : NaN)
      : explicitBulk;
    const price = saleUnit === "base" ? base : bulk;

    if (baseValid && Number.isSafeInteger(price) && price > 0) {
      return price / 100;
    }
  }

  const resolveCurrentSellingPrice = window.app?.resolveCurrentSellingPrice;

  if (typeof resolveCurrentSellingPrice === "function") {
    return Number(resolveCurrentSellingPrice(product, saleUnit) || 0);
  }

  if (saleUnit === "base") {
    return Number(product.sellingPrice || 0);
  }

  return Number(product.bulkSellingPrice ?? ((product.sellingPrice || 0) * (product.unitsPerBulk || 1)));
}

function toBaseQuantity(product, quantity, saleUnit = "bulk") {
  if (!product) {
    return 0;
  }

  return saleUnit === "base"
    ? quantity
    : quantity * Number(product.unitsPerBulk || 1);
}

function getCartProductBaseQuantity(product) {
  if (!product) {
    return 0;
  }

  return saleCart
    .filter((item) => item.productId === product.id)
    .reduce((sum, item) => sum + toBaseQuantity(product, item.quantity, item.saleUnit), 0);
}

function formatBaseQuantity(product, quantity) {
  const unitLabel = product?.baseUnit || "base unit";
  return `${quantity} ${unitLabel}(s)`;
}

function getSaleAvailabilitySummary(product, saleUnit = "bulk") {
  if (!product) {
    return {
      committedBaseQuantity: 0,
      reservedBaseQuantity: 0,
      availableBaseQuantity: 0,
      unitLabel: saleUnit,
      unitPrice: 0
    };
  }

  const committedBaseQuantity = getCommittedBaseQuantity(product);
  const reservedBaseQuantity = getCartProductBaseQuantity(product);
  const availableBaseQuantity = Math.max(committedBaseQuantity - reservedBaseQuantity, 0);

  return {
    committedBaseQuantity,
    reservedBaseQuantity,
    availableBaseQuantity,
    unitLabel: getProductUnitLabel(product, saleUnit),
    unitPrice: getSaleUnitPrice(product, saleUnit)
  };
}

function getCartTotal() {
  return saleCart.reduce((sum, item) => {
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const unitPrice = getSaleUnitPrice(product, item.saleUnit);

    return sum + (unitPrice * item.quantity);
  }, 0);
}

function renderCartItems() {
  if (saleCart.length === 0) {
    return `<div class="sale-cart-empty">No products added yet.</div>`;
  }

  return saleCart.map((item, index) => {
    const product = state.products.find((candidate) => candidate.id === item.productId);
    const unitLabel = getProductUnitLabel(product, item.saleUnit);
    const unitPrice = getSaleUnitPrice(product, item.saleUnit);
    const itemTotal = unitPrice * item.quantity;

    return `
      <div class="sale-cart-row">
        <div>
          <strong>${product?.name || "Unknown product"}</strong>
          <small>${item.quantity} ${unitLabel}(s)</small>
        </div>
        <div class="sale-cart-item-actions">
          <span>${window.app.formatReceiptCurrency(itemTotal)}</span>
          <div class="sale-quantity-controls" aria-label="Quantity controls for ${product?.name || "cart item"}">
            <button type="button" aria-label="Decrease quantity" onclick="adjustSaleCartItem(${index}, -1)">−</button>
            <b>${item.quantity}</b>
            <button type="button" aria-label="Increase quantity" onclick="adjustSaleCartItem(${index}, 1)">+</button>
          </div>
          <button class="sale-remove-button" type="button" onclick="removeSaleCartItem(${index})">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderSales(error = "") {
  ensureStockState();
  const unresolvedCheckout = getUnresolvedSecureCheckout();

  // An uncertain callable response can still have committed. Restore its exact
  // persisted request after a refresh so the cashier can only retry that key.
  if (unresolvedCheckout && saleCart.length === 0) {
    const payload = JSON.parse(unresolvedCheckout.payloadJson);
    saleCart = payload.items.map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      return {
        productId: item.productId,
        quantity: item.quantity,
        saleUnit: item.unit,
        unit: getProductUnitLabel(product, item.unit)
      };
    });
    selectedSalePaymentMethod = ({ cash: "Cash", mobile_money: "MoMo", card: "Card" })[payload.paymentMethod] || "Cash";
  }

  if (state.products.length === 0) {
    renderPage(`
      <div class="page-title">
        <h2>💰 Record Sale</h2>
        <p>Sell from existing stock after products have been received.</p>
      </div>
      <div class="message error">Add a product before recording a sale.</div>
      <button onclick="navigate('addProduct')">Add Product</button>
    `);
    return;
  }

  if (!selectedProductId || !state.products.some((product) => product.id === selectedProductId)) {
    selectedProductId = state.products[0]?.id || "";
  }

  const selectedProduct = state.products.find((product) => product.id === selectedProductId) || state.products[0];
  if (!selectedProduct) {
    return;
  }

  const options = state.products.map(
    (product) => `<option value="${product.id}" ${product.id === selectedProduct.id ? "selected" : ""}>${product.name}</option>`
  ).join("");
  const baseUnitLabel = selectedProduct.baseUnit || "base unit";
  const bulkUnitLabel = selectedProduct.bulkUnit || "bulk unit";
  const {
    availableBaseQuantity,
    unitLabel: quantityUnitLabel
  } = getSaleAvailabilitySummary(selectedProduct, selectedSaleUnit);
  const productCards = state.products
    .filter((product) => Number(product.quantity || 0) > 0)
    .map((product) => {
      const price = getSaleUnitPrice(product, selectedSaleUnit);
      const isSelected = product.id === selectedProduct.id;
    return `<button type="button" class="sale-product-card ${isSelected ? "is-selected" : ""}" data-sale-product-search="${escapeHtml(`${product.name} ${product.category || ""}`.toLowerCase())}" onclick="selectSaleProduct('${product.id}')"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || getProductUnitLabel(product, selectedSaleUnit))}</small><b>${app.formatReceiptCurrency(price)}</b></button>`;
    }).join("");
  const localPrinter = localStorage.getItem("receiptPrinterType") === "mpt58";
  const canManagePrinter = hasPermission("manage_settings");
  const printerMessage = localPrinter
    ? (posPrinterStatus.loading
      ? "Checking local printer…"
      : posPrinterStatus.ready === true
        ? "Local printer ready"
        : posPrinterStatus.ready === false
          ? "Local printer needs attention"
          : "Local printer selected")
    : "Browser receipt selected";

  renderPage(`
    <div class="page-title">
      <h2>💰 Record Sale</h2>
      <p>Choose a product, unit type, and quantity to complete a sale.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${unresolvedCheckout ? `<div class="message error">A secure checkout is awaiting confirmation. Its cart cannot be changed. Use “Review & complete sale” to retry the same server request.</div>` : ""}

    <div class="sale-panel sale-pos-layout">
      <div class="sale-summary">
        <strong>Available Stock</strong>
        <span>${formatSaleStock(selectedProduct)}</span>
        <small>Available for next sale: ${formatBaseQuantity(selectedProduct, availableBaseQuantity)}</small>
      </div>

      <section class="sale-product-picker" aria-label="Product selection">
        <div class="sale-section-heading"><div><h3>Find products</h3><p>Search, then tap an item to select it.</p></div></div>
        <input id="saleProductSearch" class="sale-product-search" type="search" inputmode="search" autocomplete="off" placeholder="Search products or categories" oninput="filterSaleProducts(this.value)">
        <div id="saleProductCards" class="sale-product-cards">${productCards || '<p class="sale-cart-empty">No in-stock products match the current list.</p>'}</div>
      </section>

      <div class="form-column sale-entry-form">
        <div class="form-row">
          <label for="productIndex">Product</label>
          <select id="productIndex" onchange="updateSalePreview()">${options}</select>
        </div>

        <div class="form-row">
          <label for="saleUnit">Unit Type</label>
          <select id="saleUnit" onchange="updateSalePreview()">
            <option value="bulk" ${selectedSaleUnit === "bulk" ? "selected" : ""}>Bulk Unit (${bulkUnitLabel})</option>
            <option value="base" ${selectedSaleUnit === "base" ? "selected" : ""}>Base Unit (${baseUnitLabel})</option>
          </select>
        </div>

        <div class="form-row">
          <label for="qty">Quantity (${quantityUnitLabel})</label>
          <input id="qty" class="number-field" type="number" inputmode="numeric" min="1" step="1" enterkeyhint="done">
        </div>

        <button class="sale-add-button" type="button" onclick="addSaleCartItem()" ${unresolvedCheckout ? "disabled" : ""}>Add to cart</button>
      </div>

      <div class="sale-cart">
        <div class="sale-cart-header">
          <strong>Sale Items</strong>
          <span>${window.app.formatReceiptCurrency(getCartTotal())}</span>
        </div>
        <div class="sale-cart-list">
          ${renderCartItems()}
        </div>
        <div class="sale-payment-methods" role="group" aria-label="Payment method">
          <span>Payment method</span>
          ${["Cash", "MoMo", "Card"].map((method) => `<button class="${selectedSalePaymentMethod === method ? "is-selected" : ""}" type="button" aria-pressed="${selectedSalePaymentMethod === method}" onclick="setSalePaymentMethod('${method}')" ${unresolvedCheckout ? "disabled" : ""}>${method}</button>`).join("")}
        </div>
        <div class="sale-checkout-total"><span>Cart total</span><strong>${window.app.formatReceiptCurrency(getCartTotal())}</strong></div>
        <button id="completeSaleButton" class="sale-complete-button" onclick="confirmSale()" ${saleCart.length ? "" : "disabled"}>${unresolvedCheckout ? "Retry secure checkout" : "Review & complete sale"}</button>
        <div class="sale-printer-status"><span class="${localPrinter && posPrinterStatus.ready === true ? "is-ready" : ""}">● ${printerMessage}</span>${canManagePrinter ? '<button type="button" onclick="navigate(\'printerSettings\')">Printer & reconnect</button>' : '<small>Printer settings are managed by authorized staff.</small>'}</div>
      </div>
    </div>
  `);

  if (localPrinter && canManagePrinter && !posPrinterStatus.checked && !posPrinterStatus.loading) {
    void refreshPosPrinterStatus();
  }
}

async function refreshPosPrinterStatus() {
  posPrinterStatus.loading = true;
  try {
    const status = await fetchPrinterBridgeStatus();
    posPrinterStatus = {
      checked: true,
      loading: false,
      ready: status.ready === true,
      message: status.message || ""
    };
  } catch (error) {
    posPrinterStatus = {
      checked: true,
      loading: false,
      ready: false,
      message: error?.message || "Receipt print service is unavailable."
    };
  }

  if (app.getCurrentPage?.() === "sales") {
    renderSales();
  }
}

function setSaleProcessing(isProcessing) {
  const button = document.getElementById("completeSaleButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Processing sale...`
    : "Complete Sale";
}

function updateSalePreview() {
  const productId = document.getElementById("productIndex")?.value;
  const saleUnit = document.getElementById("saleUnit")?.value || selectedSaleUnit;
  const product = state.products.find((item) => item.id === productId);
  const summary = document.querySelector(".sale-summary");
  const quantityLabel = document.querySelector("label[for='qty']");
  const unitSelect = document.getElementById("saleUnit");

  if (!product || !summary || !quantityLabel || !unitSelect) {
    return;
  }

  selectedProductId = product.id;
  selectedSaleUnit = saleUnit;
  const {
    availableBaseQuantity,
    unitLabel
  } = getSaleAvailabilitySummary(product, saleUnit);
  quantityLabel.textContent = `Quantity (${getProductUnitLabel(product, saleUnit)})`;
  unitSelect.innerHTML = `
    <option value="bulk" ${saleUnit === "bulk" ? "selected" : ""}>Bulk Unit (${product.bulkUnit || "bulk unit"})</option>
    <option value="base" ${saleUnit === "base" ? "selected" : ""}>Base Unit (${product.baseUnit || "base unit"})</option>
  `;

  summary.innerHTML = `
    <strong>Available Stock</strong>
    <span>${formatSaleStock(product)}</span>
    <small>Available for next sale: ${formatBaseQuantity(product, availableBaseQuantity)}</small>
  `;
}

function addSaleCartItem() {
  ensureStockState();
  if (getUnresolvedSecureCheckout()) return;

  const productId = document.getElementById("productIndex")?.value;
  const saleUnit = document.getElementById("saleUnit")?.value || "bulk";
  const quantity = Number(document.getElementById("qty")?.value);
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    renderSales("Choose a product before adding it to the sale.");
    return;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    renderSales("Quantity must be a whole number greater than zero.");
    return;
  }

  selectedProductId = productId;
  selectedSaleUnit = saleUnit;

  const requestedBaseQuantity = toBaseQuantity(product, quantity, saleUnit);
  const existingCartItem = saleCart.find((item) => item.productId === productId && item.saleUnit === saleUnit);
  const existingBaseQuantity = getCartProductBaseQuantity(product);

  if (requestedBaseQuantity + existingBaseQuantity > Number(product.quantity || 0)) {
    renderSales(`Not enough stock available for ${product.name}. Reduce the quantity or refresh inventory before trying again.`);
    return;
  }

  if (existingCartItem) {
    existingCartItem.quantity += quantity;
  } else {
    saleCart.push({
      productId,
      quantity,
      unit: getProductUnitLabel(product, saleUnit),
      saleUnit
    });
  }

  renderSales();

  const quantityInput = document.getElementById("qty");
  if (quantityInput) {
    quantityInput.value = "";
  }
}

function removeSaleCartItem(index) {
  if (getUnresolvedSecureCheckout()) return;
  saleCart.splice(index, 1);
  renderSales();
}

function adjustSaleCartItem(index, change) {
  if (getUnresolvedSecureCheckout()) return;
  const item = saleCart[index];
  const product = state.products.find((candidate) => candidate.id === item?.productId);
  if (!item || !product) return;
  const nextQuantity = item.quantity + change;
  if (nextQuantity <= 0) {
    removeSaleCartItem(index);
    return;
  }
  const otherItemsBaseQuantity = saleCart
    .filter((_, itemIndex) => itemIndex !== index)
    .filter((candidate) => candidate.productId === product.id)
    .reduce((sum, candidate) => sum + toBaseQuantity(product, candidate.quantity, candidate.saleUnit), 0);
  if (toBaseQuantity(product, nextQuantity, item.saleUnit) + otherItemsBaseQuantity > Number(product.quantity || 0)) {
    renderSales(`Not enough stock available for ${product.name}.`);
    return;
  }
  item.quantity = nextQuantity;
  renderSales();
}

function selectSaleProduct(productId) {
  if (!state.products.some((product) => product.id === productId)) return;
  selectedProductId = productId;
  renderSales();
}

function filterSaleProducts(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-sale-product-search]")).forEach((card) => {
    card.hidden = Boolean(normalizedQuery) && !card.dataset.saleProductSearch.includes(normalizedQuery);
  });
}

function setSalePaymentMethod(method) {
  if (getUnresolvedSecureCheckout()) return;
  selectedSalePaymentMethod = method;
  renderSales();
}

async function confirmSale() {
  if (saleCart.length === 0) {
    renderSales("Add at least one product before completing the sale.");
    return;
  }
  if (saleSubmissionInFlight) return;
  try {
    saleSubmissionInFlight = true;
    setSaleProcessing(true);
    const confirmation = /** @type {any} */ (await getCheckoutConfirmation(saleCart, selectedSalePaymentMethod));
    pendingCheckoutQuote = confirmation.secure ? confirmation : null;
    const tax = confirmation.sale?.taxBreakdown;
    const authoritativeTotals = confirmation.secure ? `
      <div class="sale-confirmation-totals">
        <span>Server subtotal <b>${app.formatReceiptCurrency(confirmation.sale.subtotalAmount)}</b></span>
        <span>NHIL (${Number(tax.nhilRate || 0).toFixed(1)}%) <b>${app.formatReceiptCurrency(tax.nhilAmount)}</b></span>
        <span>GETFund (${Number(tax.getfundRate || 0).toFixed(1)}%) <b>${app.formatReceiptCurrency(tax.getfundAmount)}</b></span>
        <span>VAT (${Number(tax.vatRate || 0).toFixed(1)}%) <b>${app.formatReceiptCurrency(tax.vatAmount)}</b></span>
        <strong>Final payable total <b>${app.formatReceiptCurrency(confirmation.sale.totalAmount)}</b></strong>
      </div>
      <small>These server-authoritative prices and taxes are what will be charged. If they change, you must review and confirm again.</small>
    ` : `<strong>${app.formatReceiptCurrency(getCartTotal())}</strong>`;
    app.openModal(`
    <section class="sale-confirmation">
      <p class="jyaano-eyebrow">Checkout confirmation</p>
      <h3>Complete this sale?</h3>
      <p>${saleCart.length} line item${saleCart.length === 1 ? "" : "s"} · ${selectedSalePaymentMethod}</p>
      ${authoritativeTotals}
      <small>Confirm once to record the sale. Receipt delivery is selected after the completed sale.</small>
      <div><button type="button" onclick="closeModal()">Keep editing</button><button id="confirmSaleButton" class="sale-complete-button" type="button" onclick="recordSale()">Confirm & complete</button></div>
    </section>
  `);
  } catch (error) {
    pendingCheckoutQuote = null;
    logAppError("Checkout quote failed", error);
    renderSales(toUserMessage(error, "Unable to prepare the secure checkout. Reconnect and try again."));
  } finally {
    saleSubmissionInFlight = false;
    setSaleProcessing(false);
  }
}

async function recordSale() {
  ensureStockState();

  if (saleCart.length === 0) {
    renderSales("Add at least one product before completing the sale.");
    return;
  }

  if (saleSubmissionInFlight) return;
  try {
    saleSubmissionInFlight = true;
    setSaleProcessing(true);
    document.getElementById("confirmSaleButton")?.setAttribute("disabled", "disabled");
    const sale = await createSale(saleCart, selectedSalePaymentMethod, pendingCheckoutQuote?.quoteFingerprint || "");

    if (!state.sales.some((entry) => entry.id === sale.id)) state.sales.push(sale);
    app.saveState();
    saleCart = [];
    pendingCheckoutQuote = null;
    app.closeModal();

    const printerType = getSelectedPrinterType();

    if (printerType === "mpt58") {
      renderMptReceiptPage(sale);
    } else if (printerType === "web-serial") {
      renderWebSerialReceiptPage(sale);
    } else {
      renderReceiptPage(sale);
    }

  } catch (error) {
    if (/Prices or taxes changed before this sale was submitted/i.test(toUserMessage(error))) pendingCheckoutQuote = null;
    setSaleProcessing(false);
    logAppError("Sale completion failed", error);
    renderSales(toUserMessage(error, "Unable to complete the sale. Check stock availability and try again."));
  } finally {
    saleSubmissionInFlight = false;
  }
}

function getSelectedPrinterType() {
  return localStorage.getItem("receiptPrinterType") || "browser";
}

const globalWindow = /** @type {any} */ (window);
globalWindow.renderSales = renderSales;
globalWindow.updateSalePreview = updateSalePreview;
globalWindow.addSaleCartItem = addSaleCartItem;
globalWindow.removeSaleCartItem = removeSaleCartItem;
globalWindow.adjustSaleCartItem = adjustSaleCartItem;
globalWindow.selectSaleProduct = selectSaleProduct;
globalWindow.filterSaleProducts = filterSaleProducts;
globalWindow.setSalePaymentMethod = setSalePaymentMethod;
globalWindow.confirmSale = confirmSale;
globalWindow.recordSale = recordSale;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
