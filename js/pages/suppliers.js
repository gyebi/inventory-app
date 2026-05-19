import { saveSupplierToCloud } from "../services/cloudSupplierService.js";
import { createAppError, ERROR_FLAGS, logAppError, toUserMessage } from "../utils/errorUtils.js";

const CLOUD_SAVE_TIMEOUT_MS = 20000;

const { renderPage, saveState, state } = window.app;

function renderSuppliers(error = "", values = {}, success = "") {
  const supplierCards = state.suppliers.length === 0
    ? `<div class="card">No suppliers saved yet.</div>`
    : `<div class="list-grid">${state.suppliers.map((supplier) => `
      <div class="card">
        <strong>${supplier.name}</strong><br>
        Contact Person: ${supplier.contactPerson || "N/A"}<br>
        Phone: ${supplier.phone || "N/A"}<br>
        Email: ${supplier.email || "N/A"}<br>
        Address: ${supplier.address || "N/A"}<br>
        Notes: ${supplier.notes || "N/A"}
      </div>
    `).join("")}</div>`;

  renderPage(`
    <div class="page-title">
      <h2>👥 Suppliers</h2>
      <p>Keep supplier contact details close to stock records.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${success ? `<div class="message success">${success}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="supplierName">Supplier Name</label>
        <input id="supplierName" value="${values.name || ""}">
      </div>

      <div class="form-row">
        <label for="contactPerson">Contact Person</label>
        <input id="contactPerson" value="${values.contactPerson || ""}">
      </div>

      <div class="form-row">
        <label for="supplierPhone">Phone</label>
        <input id="supplierPhone" value="${values.phone || ""}">
      </div>

      <div class="form-row">
        <label for="supplierEmail">Email</label>
        <input id="supplierEmail" type="email" value="${values.email || ""}">
      </div>

      <div class="form-row">
        <label for="supplierAddress">Address</label>
        <input id="supplierAddress" value="${values.address || ""}">
      </div>

      <div class="form-row">
        <label for="supplierNotes">Notes</label>
        <input id="supplierNotes" value="${values.notes || ""}">
      </div>

      <button id="addSupplierButton" onclick="addSupplier()">Save Supplier</button>
    </div>

    <h3>Saved Suppliers</h3>
    ${supplierCards}
  `);
}

function createSupplierId(name) {
  const nameSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `supplier_${nameSlug || Date.now()}_${Date.now()}`;
}

function setSupplierProcessing(isProcessing) {
  const button = document.getElementById("addSupplierButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving supplier...`
    : "Save Supplier";
}

async function addSupplier() {
  const name = document.getElementById("supplierName").value.trim();
  const contactPerson = document.getElementById("contactPerson").value.trim();
  const phone = document.getElementById("supplierPhone").value.trim();
  const email = document.getElementById("supplierEmail").value.trim();
  const address = document.getElementById("supplierAddress").value.trim();
  const notes = document.getElementById("supplierNotes").value.trim();
  const values = {
    name,
    contactPerson,
    phone,
    email,
    address,
    notes
  };
  const duplicateSupplier = state.suppliers.some(
    (supplier) => supplier.name.toLowerCase() === name.toLowerCase()
  );

  if (!name) {
    renderSuppliers("Supplier name is required.", values);
    return;
  }

  if (!phone && !email) {
    renderSuppliers("Enter a phone number or email for this supplier.", values);
    return;
  }

  if (duplicateSupplier) {
    renderSuppliers("A supplier with this name already exists.", values);
    return;
  }

  const currentUser = state.user;
  const supplier = {
    id: createSupplierId(name),
    name,
    contactPerson,
    phone,
    email,
    address,
    notes,
    createdAt: new Date().toISOString(),
    createdBy: currentUser
      ? {
          id: currentUser.id || currentUser.username,
          fullName: currentUser.fullName || currentUser.username,
          username: currentUser.username,
          role: currentUser.role
        }
      : null
  };

  try {
    setSupplierProcessing(true);
    await withTimeout(
      saveSupplierToCloud(supplier),
      CLOUD_SAVE_TIMEOUT_MS,
      "Firestore is taking too long to create this supplier. Check your internet connection, Firebase config, and Firestore rules before trying again."
    );
  } catch (error) {
    setSupplierProcessing(false);
    logAppError("Supplier save failed", error);
    renderSuppliers(toUserMessage(error, "Unable to save supplier to Firestore. Check your connection and try again."), values);
    return;
  }

  if (!state.suppliers.some((item) => item.id === supplier.id)) {
    state.suppliers.push(supplier);
    saveState();
  }

  renderSuppliers("", {}, "Supplier saved and synced to the cloud.");
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

window.renderSuppliers = renderSuppliers;
window.addSupplier = addSupplier;
