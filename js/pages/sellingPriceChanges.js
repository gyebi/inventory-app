import { savePriceChangeAndProductToCloud } from "../services/cloudProductService.js";
import { logAppError, toUserMessage } from "../utils/errorUtils.js";

const { renderPage, saveState, state } = window.app;

function renderSellingPriceChanges(error = "", success = "") {
  const products = state.products
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  renderPage(`
    <div class="page-title">
      <h2>Price Change</h2>
      <p>Update the current selling price for a product and keep the batch history intact.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${success ? `<div class="message success">${success}</div>` : ""}

    <form class="form-column panel" onsubmit="saveSellingPriceChange(event)">
      <div class="form-row">
        <label for="priceChangeProductId">Product</label>
        <select id="priceChangeProductId" onchange="previewPriceChangeBatches()">
          <option value="">Choose product</option>
          ${products.map((product) => `
            <option value="${product.id}">${escapeHtml(product.name)}</option>
          `).join("")}
        </select>
      </div>

      <div class="form-row">
        <label for="effectiveDate">Effective Date</label>
        <input id="effectiveDate" type="date" value="${getTodayValue()}">
      </div>

      <div class="form-row">
        <label for="newSellingPrice">New Selling Price Per Base Unit</label>
        <input id="newSellingPrice" class="number-field" type="number" min="0.01" step="0.01">
      </div>

      <div class="form-row">
        <label for="priceChangeNotes">Notes</label>
        <textarea id="priceChangeNotes" rows="3"></textarea>
      </div>

      <div id="priceChangePreview" class="sync-panel">Choose a product to preview affected batches.</div>

      <button type="submit">Save Price Change</button>
      <button type="button" onclick="navigate('home')">Back to Menu</button>
    </form>

    <h3>Price Change History</h3>
    ${renderPriceChangeHistory()}
  `);
}

function renderPriceChangeHistory() {
  if (!Array.isArray(state.priceChanges) || state.priceChanges.length === 0) {
    return `<div class="card">No selling-price changes have been recorded yet.</div>`;
  }

  return `
    <div class="list-grid">
      ${state.priceChanges
        .slice()
        .sort((left, right) => new Date(right.effectiveDate || right.createdAt || 0) - new Date(left.effectiveDate || left.createdAt || 0))
        .map((entry) => `
          <div class="card">
            <strong>${escapeHtml(getProductName(entry.productId))}</strong><br>
            Effective Date: ${entry.effectiveDate || "N/A"}<br>
            Old Price: ${formatCurrency(entry.oldSellingPrice)}<br>
            New Price: ${formatCurrency(entry.newSellingPrice)}<br>
            Affected Batches: ${Array.isArray(entry.affectedBatchIds) ? entry.affectedBatchIds.length : 0}<br>
            Notes: ${entry.notes || "N/A"}
          </div>
        `).join("")}
    </div>
  `;
}

function previewPriceChangeBatches() {
  const productId = document.getElementById("priceChangeProductId")?.value || "";
  const preview = document.getElementById("priceChangePreview");
  const product = getProductById(productId);

  if (!preview) {
    return;
  }

  if (!product) {
    preview.innerHTML = "Choose a product to preview affected batches.";
    return;
  }

  const affectedBatches = getAffectedBatches(productId);
  const currentSellingPrice = window.app?.resolveCurrentSellingPrice?.(product, "base") || Number(product.sellingPrice || 0);
  const currentBulkSellingPrice = window.app?.resolveCurrentSellingPrice?.(product, "bulk") || Number(product.bulkSellingPrice || 0);

  preview.innerHTML = `
    <strong>${escapeHtml(product.name)}</strong><br>
    Current selling price: ${formatCurrency(currentSellingPrice)}<br>
    Current bulk selling price: ${formatCurrency(currentBulkSellingPrice)}<br>
    Active batches affected: ${affectedBatches.length}<br>
    ${affectedBatches.length > 0 ? affectedBatches.map((batch) => `
      Batch ${escapeHtml(batch.id)} at ${formatCurrency(batch.unitSellingPrice)}<br>
    `).join("") : "No active batches found."}
  `;
}

async function saveSellingPriceChange(event) {
  event?.preventDefault?.();

  const productId = document.getElementById("priceChangeProductId")?.value || "";
  const effectiveDate = document.getElementById("effectiveDate")?.value || "";
  const newSellingPrice = Number(document.getElementById("newSellingPrice")?.value || 0);
  const notes = document.getElementById("priceChangeNotes")?.value.trim() || "";
  const product = getProductById(productId);

  if (!product) {
    renderSellingPriceChanges("Choose a product before saving the price change.");
    return;
  }

  if (!effectiveDate) {
    renderSellingPriceChanges("Choose an effective date.");
    return;
  }

  if (!Number.isFinite(newSellingPrice) || newSellingPrice <= 0) {
    renderSellingPriceChanges("Enter a valid new selling price.");
    return;
  }

  const affectedBatches = getAffectedBatches(productId, effectiveDate);
  const oldSellingPrice = Number(window.app?.resolveCurrentSellingPrice?.(product, "base") || product.sellingPrice || 0);
  const bulkSellingPrice = newSellingPrice * Number(product.unitsPerBulk || 1);
  const changeId = `price_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const priceChange = {
    id: changeId,
    productId,
    productName: product.name,
    effectiveDate,
    oldSellingPrice,
    newSellingPrice,
    affectedBatchIds: affectedBatches.map((batch) => batch.id),
    notes,
    createdAt: new Date().toISOString(),
    createdBy: state.user
      ? {
          id: state.user.id || state.user.username,
          fullName: state.user.fullName || state.user.username,
          username: state.user.username,
          role: state.user.role
        }
      : null
  };

  product.sellingPrice = newSellingPrice;
  product.bulkSellingPrice = bulkSellingPrice;
  product.sellingPriceEffectiveDate = effectiveDate;
  product.sellingPriceUpdatedAt = new Date().toISOString();

  affectedBatches.forEach((batch) => {
    batch.unitSellingPrice = newSellingPrice;
    batch.bulkSellingPrice = bulkSellingPrice;
    batch.sellingPriceEffectiveDate = effectiveDate;
    batch.sellingPriceChangeId = changeId;
  });

  try {
    await savePriceChangeAndProductToCloud(priceChange, product);
  } catch (error) {
    logAppError("Price change save failed", error);
    renderSellingPriceChanges(
      toUserMessage(error, "Unable to save the price change to Firestore. Check your connection and try again."),
      ""
    );
    return;
  }

  state.priceChanges.push(priceChange);
  saveState();
  renderSellingPriceChanges("", "Selling price saved and batch history recorded.");
}

function getAffectedBatches(productId, effectiveDate = "") {
  const cutoff = effectiveDate ? new Date(`${effectiveDate}T00:00:00`) : null;

  return (state.stock || []).filter((batch) => {
    if (batch.productId !== productId || Number(batch.quantity || 0) <= 0) {
      return false;
    }

    if (!cutoff) {
      return isBatchCurrentlyActive(batch);
    }

    return isBatchActiveOnDate(batch, cutoff);
  });
}

function isBatchCurrentlyActive(batch) {
  return isBatchActiveOnDate(batch, new Date());
}

function isBatchActiveOnDate(batch, cutoff) {
  if (!batch) {
    return false;
  }

  const receivedAt = batch.receivedAt || batch.purchaseDate || batch.createdAt;
  const receivedDate = receivedAt ? new Date(receivedAt) : null;
  const expiryDate = batch.expiryDate ? new Date(`${batch.expiryDate}T23:59:59.999`) : null;

  if (receivedDate && Number.isNaN(receivedDate.getTime())) {
    return false;
  }

  if (expiryDate && Number.isNaN(expiryDate.getTime())) {
    return false;
  }

  const isReceivedByCutoff = !receivedDate || receivedDate <= cutoff;
  const isNotExpiredByCutoff = !expiryDate || expiryDate >= cutoff;

  return isReceivedByCutoff && isNotExpiredByCutoff;
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId);
}

function getProductName(productId) {
  return getProductById(productId)?.name || "Unknown product";
}

function getTodayValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `Ghs ${amount.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.renderSellingPriceChanges = renderSellingPriceChanges;
window.previewPriceChangeBatches = previewPriceChangeBatches;
window.saveSellingPriceChange = saveSellingPriceChange;
