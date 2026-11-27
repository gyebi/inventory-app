import { renderReceiptPage } from "../services/receiptService.js";
import { renderAndroidRawBtReceiptPage } from "../services/androidRawBtReceiptService.js";
import { createSale, getCheckoutConfirmation } from "../services/salesService.js";
import { getUnresolvedSecureCheckout } from "../services/secureCheckoutService.js";
import { getUnresolvedOpeningStockCheckout } from "../services/openingStockCheckoutService.js";
import { checkProvisionalOpeningStockEligibility, getUnresolvedProvisionalOpeningStockCheckout } from "../services/provisionalOpeningStockCheckoutService.js";
import { logAppError, toUserMessage } from "../utils/errorUtils.js";
import { hasPermission } from "../services/authService.js";
import { fetchPrinterBridgeStatus } from "../services/printerBridgeService.js";
import { LEGACY_SALE_PAYMENT_METHODS } from "../services/legacySalePayment.js";
import { sortProductsForPresentation } from "../utils/presentationSort.js";

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
let provisionalEligibility = { productId: "", loading: false, eligible: false, expectedRevision: 0, details: null };
let provisionalDraft = {};

function openingStockSetup(productId) {
  return (state.openingStockProducts || []).find((setup) => setup.productId === productId && setup.status === "unverified") || null;
}

function isPotentialProvisionalProduct(product) {
  return product && Number(product.inventorySchemaVersion) !== 2 &&
    product.active !== false && product.isActive !== false &&
    Number(product.quantity || 0) === 0 && Number(product.sellableQuantity || 0) === 0;
}

function rememberProvisionalDraft() {
  const value = (id) => /** @type {HTMLInputElement|HTMLSelectElement|null} */ (document.getElementById(id))?.value || "";
  provisionalDraft = {
    baseUnit: value("provisionalBaseUnit") || provisionalDraft.baseUnit || "",
    saleUnit: value("provisionalSaleUnit") || provisionalDraft.saleUnit || "base",
    bulkUnit: value("provisionalBulkUnit") || provisionalDraft.bulkUnit || "",
    unitsPerBulk: value("provisionalUnitsPerBulk") || provisionalDraft.unitsPerBulk || "",
    unitPrice: value("provisionalUnitPrice") || provisionalDraft.unitPrice || "",
    quantity: value("provisionalQuantity") || provisionalDraft.quantity || ""
  };
}

function renderProvisionalEntry(product, unresolvedCheckout) {
  if (provisionalEligibility.productId !== product.id || provisionalEligibility.loading) {
    if (provisionalEligibility.productId !== product.id && !provisionalEligibility.loading) void loadProvisionalEligibility(product.id);
    return `<p class="field-hint">Checking whether this unconfigured legacy product can be sold provisionally…</p>`;
  }
  if (!provisionalEligibility.eligible) return `<p class="field-hint">This product needs approved setup or stock review before it can be sold.</p>`;
  const defaults = provisionalEligibility.details || {};
  const draft = { baseUnit: defaults.baseUnit || "", saleUnit: defaults.saleUnit || "base", bulkUnit: defaults.bulkUnit || "", unitsPerBulk: defaults.unitsPerBulk || "", unitPrice: defaults.unitPricePesewas ? Number(defaults.unitPricePesewas) / 100 : "", quantity: "", ...provisionalDraft };
  const bulk = draft.saleUnit === "bulk";
  const conversion = bulk && Number.isInteger(Number(draft.unitsPerBulk)) && Number(draft.unitsPerBulk) > 0 && Number(draft.quantity) > 0
    ? `<p class="field-hint">${escapeHtml(draft.quantity)} ${escapeHtml(draft.bulkUnit || "bulk units")} × ${escapeHtml(draft.unitsPerBulk)} ${escapeHtml(draft.baseUnit || "base units")} = ${Number(draft.quantity) * Number(draft.unitsPerBulk)} ${escapeHtml(draft.baseUnit || "base units")}</p>` : "";
  return `<div class="message success"><strong>Complete details to sell</strong><br><small>These details are provisional and await manager review. They do not change approved product setup.</small></div>
    <div class="form-row"><label for="provisionalBaseUnit">Base-unit label</label><input id="provisionalBaseUnit" maxlength="40" value="${escapeHtml(draft.baseUnit)}" oninput="rememberProvisionalDraft()"></div>
    <div class="form-row"><label for="provisionalSaleUnit">Selected sale unit</label><select id="provisionalSaleUnit" onchange="rememberProvisionalDraft(); renderSales()"><option value="base" ${!bulk ? "selected" : ""}>Base</option><option value="bulk" ${bulk ? "selected" : ""}>Bulk</option></select></div>
    ${bulk ? `<div class="form-row"><label for="provisionalBulkUnit">Bulk-unit label</label><input id="provisionalBulkUnit" maxlength="40" value="${escapeHtml(draft.bulkUnit)}" oninput="rememberProvisionalDraft()"></div><div class="form-row"><label for="provisionalUnitsPerBulk">Base units per bulk</label><input id="provisionalUnitsPerBulk" type="number" min="1" step="1" value="${escapeHtml(draft.unitsPerBulk)}" oninput="rememberProvisionalDraft(); renderSales()"></div>` : ""}
    <div class="form-row"><label for="provisionalUnitPrice">Selling price per selected unit (GHS)</label><input id="provisionalUnitPrice" type="number" min="0.01" step="0.01" value="${escapeHtml(draft.unitPrice)}" oninput="rememberProvisionalDraft()"></div>
    <div class="form-row"><label for="provisionalQuantity">Quantity</label><input id="provisionalQuantity" type="number" min="1" step="1" value="${escapeHtml(draft.quantity)}" oninput="rememberProvisionalDraft(); renderSales()"></div>${conversion}
    <button class="sale-add-button" type="button" onclick="addProvisionalSaleCartItem()" ${unresolvedCheckout ? "disabled" : ""}>Add provisional sale</button>`;
}

async function loadProvisionalEligibility(productId) {
  provisionalEligibility = { productId, loading: true, eligible: false, expectedRevision: 0, details: null };
  try {
    const result = /** @type {any} */ (await checkProvisionalOpeningStockEligibility(productId));
    if (provisionalEligibility.productId === productId) provisionalEligibility = { productId, loading: false, eligible: result?.eligible === true, expectedRevision: Number(result?.expectedRevision || 0), details: result?.details || null };
  } catch {
    if (provisionalEligibility.productId === productId) provisionalEligibility = { productId, loading: false, eligible: false, expectedRevision: 0, details: null };
  }
  if (app.getCurrentPage?.() === "sales") renderSales();
}

function provisionalPesewas(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && Math.round(amount * 100) === amount * 100 ? Math.round(amount * 100) : null;
}

function addProvisionalSaleCartItem() {
  rememberProvisionalDraft();
  const product = state.products.find((item) => item.id === selectedProductId);
  const quantity = Number(provisionalDraft.quantity);
  const saleUnit = provisionalDraft.saleUnit;
  const details = { baseUnit: String(provisionalDraft.baseUnit || "").trim(), saleUnit, unitPricePesewas: provisionalPesewas(provisionalDraft.unitPrice) };
  if (saleUnit === "bulk") { details.bulkUnit = String(provisionalDraft.bulkUnit || "").trim(); details.unitsPerBulk = Number(provisionalDraft.unitsPerBulk); }
  if (!product || !provisionalEligibility.eligible || !Number.isInteger(quantity) || quantity < 1 || !details.baseUnit || !details.unitPricePesewas || (saleUnit === "bulk" && (!details.bulkUnit || !Number.isInteger(details.unitsPerBulk) || details.unitsPerBulk < 1))) {
    renderSales("Complete valid provisional unit, price, and quantity details before adding the sale."); return;
  }
  if (saleCart.some((item) => !item.provisionalOpeningStock)) { renderSales("Provisional opening-stock items cannot be mixed with verified or approved-opening-stock items."); return; }
  if (saleCart.some((item) => item.productId === product.id)) { renderSales("Combine this provisional product on its existing cart line before checkout."); return; }
  if (saleCart.length >= 20) { renderSales("A provisional opening-stock sale supports up to 20 distinct products."); return; }
  saleCart.push({ productId: product.id, quantity, saleUnit, unit: saleUnit === "bulk" ? details.bulkUnit : details.baseUnit, provisionalOpeningStock: true, provisionalDetails: details, provisionalExpectedRevision: provisionalEligibility.expectedRevision });
  provisionalDraft = {};
  renderSales();
}

function formatSaleStock(product) {
  const quantity = getCommittedBaseQuantity(product);
  const unitsPerBulk = Number(product?.unitsPerBulk || 1) > 0 ? Number(product.unitsPerBulk) : 1;
  return `${Math.floor(quantity / unitsPerBulk)} ${product?.bulkUnit || "bulk unit"}(s) and ${quantity % unitsPerBulk} ${product?.baseUnit || "base unit"}(s)`;
}

function getCommittedBaseQuantity(product) {
  return app.getSellableQuantity(product);
}

function getProductUnitLabel(product, saleUnit = "bulk") {
  if (!product) {
    return saleUnit;
  }

  const opening = openingStockSetup(product.id);
  return saleUnit === "base"
    ? (opening?.baseUnit || product.baseUnit || "base unit")
    : (opening?.bulkUnit || product.bulkUnit || "bulk unit");
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

  const opening = openingStockSetup(product.id);
  if (opening) return Number(saleUnit === "base" ? opening.basePricePesewas : opening.bulkPricePesewas) / 100;

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

  const opening = openingStockSetup(product.id);
  return saleUnit === "base"
    ? quantity
    : quantity * Number(opening?.unitsPerBulk || product.unitsPerBulk || 1);
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

  const opening = openingStockSetup(product.id);
  const committedBaseQuantity = getCommittedBaseQuantity(product);
  const reservedBaseQuantity = getCartProductBaseQuantity(product);
  const availableBaseQuantity = opening ? null : Math.max(committedBaseQuantity - reservedBaseQuantity, 0);

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
    if (item.provisionalOpeningStock) return sum + (Number(item.provisionalDetails?.unitPricePesewas || 0) / 100 * item.quantity);
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
    const unitLabel = item.provisionalOpeningStock ? (item.provisionalDetails.saleUnit === "bulk" ? item.provisionalDetails.bulkUnit : item.provisionalDetails.baseUnit) : getProductUnitLabel(product, item.saleUnit);
    const unitPrice = item.provisionalOpeningStock ? Number(item.provisionalDetails.unitPricePesewas) / 100 : getSaleUnitPrice(product, item.saleUnit);
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
  const unresolvedCheckout = getUnresolvedSecureCheckout() || getUnresolvedOpeningStockCheckout() || getUnresolvedProvisionalOpeningStockCheckout();

  // An uncertain callable response can still have committed. Restore its exact
  // persisted request after a refresh so the cashier can only retry that key.
  if (unresolvedCheckout && saleCart.length === 0) {
    const payload = JSON.parse(unresolvedCheckout.payloadJson);
    saleCart = Array.isArray(payload.items) ? payload.items.map((item) => {
      const product = state.products.find((entry) => entry.id === item.productId);
      if (item.details) return { productId: item.productId, quantity: item.quantity, saleUnit: item.details.saleUnit,
        unit: item.details.saleUnit === "bulk" ? item.details.bulkUnit : item.details.baseUnit,
        provisionalOpeningStock: true, provisionalDetails: item.details, provisionalExpectedRevision: item.expectedRevision };
      return { productId: item.productId, quantity: item.quantity, saleUnit: item.unit, unit: getProductUnitLabel(product, item.unit) };
    }) : payload.details ? [{
      productId: payload.productId, quantity: payload.quantity, saleUnit: payload.details.saleUnit,
      unit: payload.details.saleUnit === "bulk" ? payload.details.bulkUnit : payload.details.baseUnit,
      provisionalOpeningStock: true, provisionalDetails: payload.details,
      provisionalExpectedRevision: payload.expectedRevision
    }] : [];
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

  const products = sortProductsForPresentation(state.products);

  if (!selectedProductId || !products.some((product) => product.id === selectedProductId)) {
    selectedProductId = products[0]?.id || "";
  }

  const selectedProduct = products.find((product) => product.id === selectedProductId) || products[0];
  if (!selectedProduct) {
    return;
  }

  const options = products.map(
    (product) => `<option value="${product.id}" ${product.id === selectedProduct.id ? "selected" : ""}>${product.name}</option>`
  ).join("");
  const baseUnitLabel = selectedProduct.baseUnit || "base unit";
  const bulkUnitLabel = selectedProduct.bulkUnit || "bulk unit";
  const {
    availableBaseQuantity,
    unitLabel: quantityUnitLabel
  } = getSaleAvailabilitySummary(selectedProduct, selectedSaleUnit);
  const productCards = sortProductsForPresentation(products
    .filter((product) => getCommittedBaseQuantity(product) > 0 || openingStockSetup(product.id) || isPotentialProvisionalProduct(product)))
    .map((product) => {
      const price = getSaleUnitPrice(product, selectedSaleUnit);
      const isSelected = product.id === selectedProduct.id;
    return `<button type="button" class="sale-product-card ${isSelected ? "is-selected" : ""}" data-sale-product-search="${escapeHtml(`${product.name} ${product.category || ""}`.toLowerCase())}" onclick="selectSaleProduct('${product.id}')"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || getProductUnitLabel(product, selectedSaleUnit))}</small><b>${app.formatReceiptCurrency(price)}</b></button>`;
    }).join("");
  const localPrinter = localStorage.getItem("receiptPrinterType") === "mpt58";
  const canManagePrinter = hasPermission("manage_settings");
  const printerMessage =
    localStorage.getItem("receiptPrinterType") === "android-rawbt"
      ? "Android / RawBT selected"
      : localPrinter
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
    ${unresolvedCheckout ? `<div class="message error">A server checkout is awaiting confirmation. Its cart cannot be changed. Use “Review & complete sale” to retry the same server request.</div>` : ""}

    <div class="sale-panel sale-pos-layout">
      <div class="sale-summary">
        <strong>Available Stock</strong>
        <span>${openingStockSetup(selectedProduct.id) ? "Opening stock: count still required" : formatSaleStock(selectedProduct)}</span>
        <small>${openingStockSetup(selectedProduct.id) ? "This Admin-approved item records sales without a stock deduction until the physical count is confirmed." : `Available for next sale: ${formatBaseQuantity(selectedProduct, availableBaseQuantity)}`}</small>
      </div>

      <section class="sale-product-picker" aria-label="Product selection">
        <div class="sale-section-heading"><div><h3>Find products</h3><p>Search, then tap an item to select it.</p></div></div>
        <input id="saleProductSearch" class="sale-product-search" type="search" inputmode="search" autocomplete="off" placeholder="Search products or categories" oninput="filterSaleProducts(this.value)">
        <div id="saleProductCards" class="sale-product-cards">${productCards || '<p class="sale-cart-empty">No sellable or approved opening-stock products match the current list.</p>'}</div>
      </section>

      <div class="form-column sale-entry-form">
        <div class="form-row">
          <label for="productIndex">Product</label>
          <select id="productIndex" onchange="updateSalePreview()">${options}</select>
        </div>

        ${isPotentialProvisionalProduct(selectedProduct) && !openingStockSetup(selectedProduct.id) ? renderProvisionalEntry(selectedProduct, unresolvedCheckout) : `<div class="form-row">
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

        <button class="sale-add-button" type="button" onclick="addSaleCartItem()" ${unresolvedCheckout ? "disabled" : ""}>Add to cart</button>`}
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
          ${LEGACY_SALE_PAYMENT_METHODS.map((method) => `<button class="${selectedSalePaymentMethod === method ? "is-selected" : ""}" type="button" aria-pressed="${selectedSalePaymentMethod === method}" onclick="setSalePaymentMethod('${method}')" ${unresolvedCheckout ? "disabled" : ""}>${method}</button>`).join("")}
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
  if (isPotentialProvisionalProduct(product) && !openingStockSetup(product.id) && provisionalEligibility.productId !== product.id) {
    provisionalDraft = {};
    void loadProvisionalEligibility(product.id);
    return;
  }
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
  if (getUnresolvedSecureCheckout() || getUnresolvedOpeningStockCheckout()) return;

  const productId = document.getElementById("productIndex")?.value;
  const saleUnit = document.getElementById("saleUnit")?.value || "bulk";
  const quantity = Number(document.getElementById("qty")?.value);
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    renderSales("Choose a product before adding it to the sale.");
    return;
  }

  if (isPotentialProvisionalProduct(product) && !openingStockSetup(product.id)) {
    renderSales("This unconfigured legacy product can only be added through the server-confirmed provisional details form.");
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
  const opening = openingStockSetup(productId);
  const cartHasOpening = saleCart.some((item) => openingStockSetup(item.productId));
  const cartHasVerified = saleCart.some((item) => !openingStockSetup(item.productId));

  if ((opening && cartHasVerified) || (!opening && cartHasOpening)) {
    renderSales("Opening-stock items must be completed separately from verified stock. This prevents a partial checkout or stock deduction.");
    return;
  }
  if (saleCart.some((item) => item.provisionalOpeningStock)) {
    renderSales("Verified or approved-opening-stock items cannot be mixed with provisional opening-stock items.");
    return;
  }

  if (!opening && requestedBaseQuantity + existingBaseQuantity > getCommittedBaseQuantity(product)) {
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
  if (getUnresolvedSecureCheckout() || getUnresolvedOpeningStockCheckout()) return;
  saleCart.splice(index, 1);
  renderSales();
}

function adjustSaleCartItem(index, change) {
  if (getUnresolvedSecureCheckout() || getUnresolvedOpeningStockCheckout()) return;
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
  if (!item.provisionalOpeningStock && !openingStockSetup(product.id) && toBaseQuantity(product, nextQuantity, item.saleUnit) + otherItemsBaseQuantity > getCommittedBaseQuantity(product)) {
    renderSales(`Not enough stock available for ${product.name}.`);
    return;
  }
  item.quantity = nextQuantity;
  renderSales();
}

function selectSaleProduct(productId) {
  if (!state.products.some((product) => product.id === productId)) return;
  selectedProductId = productId;
  provisionalDraft = {};
  const product = state.products.find((entry) => entry.id === productId);
  if (isPotentialProvisionalProduct(product) && !openingStockSetup(productId)) void loadProvisionalEligibility(productId);
  renderSales();
}

function filterSaleProducts(query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-sale-product-search]")).forEach((card) => {
    card.hidden = Boolean(normalizedQuery) && !card.dataset.saleProductSearch.includes(normalizedQuery);
  });
}

function setSalePaymentMethod(method) {
  if (getUnresolvedSecureCheckout() || getUnresolvedOpeningStockCheckout()) return;
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
    pendingCheckoutQuote = confirmation.secure || confirmation.openingStock || confirmation.provisionalOpeningStock ? confirmation : null;
    const tax = confirmation.sale?.taxBreakdown;
    const authoritativeTotals = (confirmation.secure || confirmation.openingStock || confirmation.provisionalOpeningStock) ? `
      <div class="sale-confirmation-totals">
        <span>Subtotal <b>${app.formatReceiptCurrency(confirmation.sale.subtotalAmount)}</b></span>
        <span>NHIL (${Number(tax.nhilRate || 0).toFixed(1)}%) <b>${app.formatReceiptCurrency(tax.nhilAmount)}</b></span>
        <span>GETFund (${Number(tax.getfundRate || 0).toFixed(1)}%) <b>${app.formatReceiptCurrency(tax.getfundAmount)}</b></span>
        <span>VAT (${Number(tax.vatRate || 0).toFixed(1)}%) <b>${app.formatReceiptCurrency(tax.vatAmount)}</b></span>
        <strong>Final payable total <b>${app.formatReceiptCurrency(confirmation.sale.totalAmount)}</b></strong>
      </div>
    ` : `<strong>${app.formatReceiptCurrency(getCartTotal())}</strong>`;
    app.openModal(`
    <section class="sale-confirmation">
      <p class="jyaano-eyebrow">Checkout confirmation</p>
      <h3>Complete this sale?</h3>
      <p>${saleCart.length} line item${saleCart.length === 1 ? "" : "s"} · ${selectedSalePaymentMethod}</p>
      ${authoritativeTotals}
      <small>Confirm once to record the sale. Receipt delivery is selected after the completed sale.</small>
      <div><button id="confirmSaleButton" class="sale-complete-button" type="button" onclick="recordSale()">Confirm & complete</button></div>
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
    const sale = await createSale(saleCart, selectedSalePaymentMethod, pendingCheckoutQuote?.quoteFingerprint || "", pendingCheckoutQuote?.openingStock === true, pendingCheckoutQuote?.provisionalOpeningStock === true);

    if (!state.sales.some((entry) => entry.id === sale.id)) state.sales.push(sale);
    app.saveState();
    saleCart = [];
    pendingCheckoutQuote = null;
    app.closeModal();

    const printerType = getSelectedPrinterType();

    if (printerType === "android-rawbt") {
      renderAndroidRawBtReceiptPage(sale);
    } else if (printerType === "mpt58") {
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
globalWindow.addProvisionalSaleCartItem = addProvisionalSaleCartItem;
globalWindow.rememberProvisionalDraft = rememberProvisionalDraft;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
