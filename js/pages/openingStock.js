import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";
import { toUserMessage } from "../utils/errorUtils.js";

const app = /** @type {any} */ (window).app;
const { renderPage, state } = app;
let selectedProductId = "";
let message = "";

const setupFor = (productId) => (state.openingStockProducts || []).find((entry) => entry.productId === productId) || null;
const eligible = () => state.products.filter((product) => Number(product.inventorySchemaVersion) !== 2 && product.active !== false && product.isActive !== false && Number(product.quantity || 0) === 0 && Number(product.sellableQuantity || 0) === 0);
const pesewas = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && Math.round(amount * 100) === amount * 100 ? Math.round(amount * 100) : null;
};
const inputValue = (id) => /** @type {HTMLInputElement|HTMLTextAreaElement|null} */ (document.getElementById(id))?.value || "";
const checked = (id) => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.checked === true;

function renderOpeningStock(error = "") {
  const products = eligible();
  if (!selectedProductId || !products.some((product) => product.id === selectedProductId)) selectedProductId = products[0]?.id || "";
  const product = products.find((entry) => entry.id === selectedProductId);
  const setup = product ? setupFor(product.id) : null;
  const status = setup?.status || "not enabled";
  renderPage(`
    <div class="page-title"><h2>◉ Opening Stock</h2><p>Admin-only: enable unverified selling, then count physical stock before normal checkout begins.</p></div>
    ${error ? `<div class="message error">${escapeHtml(error)}</div>` : ""}${message ? `<div class="message success">${escapeHtml(message)}</div>` : ""}
    ${product ? `<div class="form-column panel">
      <div class="form-row"><label for="openingProduct">Eligible zero-stock legacy product</label><select id="openingProduct" onchange="selectOpeningProduct(this.value)">${products.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === product.id ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("")}</select></div>
      <p class="field-hint">Status: <strong>${escapeHtml(status)}</strong>. v2 products and products with recorded stock are deliberately excluded.</p>
      ${status === "not enabled" || status === "unverified" ? `<div class="form-row"><label for="openingBaseUnit">Base unit</label><input id="openingBaseUnit" value="${escapeHtml(setup?.baseUnit || product.baseUnit || "")}"></div>
      <div class="form-row"><label for="openingBulkUnit">Bulk unit</label><input id="openingBulkUnit" value="${escapeHtml(setup?.bulkUnit || product.bulkUnit || "")}"></div>
      <div class="form-row"><label for="openingUnits">Base units per bulk</label><input id="openingUnits" type="number" min="1" step="1" value="${Number(setup?.unitsPerBulk || product.unitsPerBulk || 1)}"></div>
      <div class="form-row"><label for="openingBasePrice">Approved base selling price (GHS)</label><input id="openingBasePrice" type="number" min="0.01" step="0.01" value="${setup ? Number(setup.basePricePesewas) / 100 : Number(product.sellingPrice || 0) || ""}"></div>
      <div class="form-row"><label for="openingBulkPrice">Approved bulk selling price (GHS)</label><input id="openingBulkPrice" type="number" min="0.01" step="0.01" value="${setup ? Number(setup.bulkPricePesewas) / 100 : Number(product.bulkSellingPrice || 0) || ""}"></div>
      <label><input id="openingConfirm" type="checkbox"> I confirm this product has no verified opening stock.</label>
      <button type="button" onclick="saveOpeningSetup()">Enable opening-stock selling</button>
      ${status === "unverified" ? `<button type="button" onclick="startOpeningCount()">Start physical count</button>` : ""}` : ""}
      ${status === "counting" ? `<div class="form-row"><label for="openingBatches">Counted batches, one per line: reference: base quantity</label><textarea id="openingBatches" rows="4" placeholder="Shelf A: 12\nShelf B: 3"></textarea><small>Use an empty list only to confirm explicit zero stock. No supplier, cost, or expiry is recorded.</small></div><button type="button" onclick="confirmOpeningCount()">Confirm count and activate stock</button><button type="button" onclick="cancelOpeningCount()">Abandon count and resume unverified selling</button>` : ""}
      ${status === "verified" ? `<p class="field-hint">Opening balance is verified. Normal stock-controlled checkout is active.</p>` : ""}
    </div>` : `<div class="card">There are no eligible legacy zero-stock products. Add a product first, or use the normal inventory workflow.</div>`}
  `);
}

function selectOpeningProduct(productId) { selectedProductId = productId; message = ""; renderOpeningStock(); }
async function call(name, data) { return (await httpsCallable(functions, name)(data)).data; }
function activeSetup() { return setupFor(selectedProductId); }

async function saveOpeningSetup() {
  const setup = activeSetup();
  const payload = { productId: selectedProductId, baseUnit: inputValue("openingBaseUnit").trim(), bulkUnit: inputValue("openingBulkUnit").trim(), unitsPerBulk: Number(inputValue("openingUnits")), basePricePesewas: pesewas(inputValue("openingBasePrice")), bulkPricePesewas: pesewas(inputValue("openingBulkPrice")), expectedRevision: Number(setup?.revision || 0), confirmUncounted: checked("openingConfirm") };
  try { await call("configureOpeningStockProduct", payload); message = "Opening-stock selling is enabled after server confirmation."; renderOpeningStock(); } catch (error) { renderOpeningStock(toUserMessage(error, "Unable to save opening-stock setup.")); }
}
async function startOpeningCount() {
  const setup = activeSetup();
  try { await call("startOpeningStockCount", { productId: selectedProductId, expectedRevision: setup?.revision }); message = "Count started. Sales and stock changes for this product are now paused."; renderOpeningStock(); } catch (error) { renderOpeningStock(toUserMessage(error, "Unable to start the physical count.")); }
}
function parseBatches(value) {
  if (!value.trim()) return [];
  return value.split("\n").filter(Boolean).map((line) => { const match = /^(.+?):\s*(\d+)$/.exec(line.trim()); if (!match || Number(match[2]) < 1) throw new Error("Use one batch per line as reference: positive whole base quantity."); return { reference: match[1].trim(), baseQuantity: Number(match[2]) }; });
}
async function confirmOpeningCount() {
  const setup = activeSetup();
  try { await call("confirmOpeningStockCount", { productId: selectedProductId, expectedRevision: setup?.revision, batches: parseBatches(inputValue("openingBatches")) }); message = "Opening balance confirmed. Normal stock-controlled checkout is active."; renderOpeningStock(); } catch (error) { renderOpeningStock(toUserMessage(error, error?.message || "Unable to confirm the physical count.")); }
}
async function cancelOpeningCount() {
  const setup = activeSetup();
  try { await call("cancelOpeningStockCount", { productId: selectedProductId, expectedRevision: setup?.revision }); message = "Count abandoned. Unverified selling resumed; stock was not changed."; renderOpeningStock(); } catch (error) { renderOpeningStock(toUserMessage(error, "Unable to abandon the physical count.")); }
}
function escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

const globalWindow = /** @type {any} */ (window);
globalWindow.renderOpeningStock = renderOpeningStock;
globalWindow.selectOpeningProduct = selectOpeningProduct;
globalWindow.saveOpeningSetup = saveOpeningSetup;
globalWindow.startOpeningCount = startOpeningCount;
globalWindow.confirmOpeningCount = confirmOpeningCount;
globalWindow.cancelOpeningCount = cancelOpeningCount;
