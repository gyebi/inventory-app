function renderSuppliers(error = "") {
  const supplierCards = state.suppliers.length === 0
    ? `<div class="card">No suppliers saved yet.</div>`
    : state.suppliers.map((supplier) => `
      <div class="card">
        <strong>${supplier.name}</strong><br>
        Contact Person: ${supplier.contactPerson || "N/A"}<br>
        Phone: ${supplier.phone || "N/A"}<br>
        Email: ${supplier.email || "N/A"}<br>
        Address: ${supplier.address || "N/A"}<br>
        Notes: ${supplier.notes || "N/A"}
      </div>
    `).join("");

  renderPage(`
    <h2>👥 Suppliers</h2>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column">
      <div class="form-row">
        <label for="supplierName">Supplier Name</label>
        <input id="supplierName">
      </div>

      <div class="form-row">
        <label for="contactPerson">Contact Person</label>
        <input id="contactPerson">
      </div>

      <div class="form-row">
        <label for="supplierPhone">Phone</label>
        <input id="supplierPhone">
      </div>

      <div class="form-row">
        <label for="supplierEmail">Email</label>
        <input id="supplierEmail" type="email">
      </div>

      <div class="form-row">
        <label for="supplierAddress">Address</label>
        <input id="supplierAddress">
      </div>

      <div class="form-row">
        <label for="supplierNotes">Notes</label>
        <input id="supplierNotes">
      </div>

      <button onclick="addSupplier()">Save Supplier</button>
    </div>

    <h3>Saved Suppliers</h3>
    ${supplierCards}
  `);
}

function addSupplier() {
  const name = document.getElementById("supplierName").value.trim();
  const contactPerson = document.getElementById("contactPerson").value.trim();
  const phone = document.getElementById("supplierPhone").value.trim();
  const email = document.getElementById("supplierEmail").value.trim();
  const address = document.getElementById("supplierAddress").value.trim();
  const notes = document.getElementById("supplierNotes").value.trim();
  const duplicateSupplier = state.suppliers.some(
    (supplier) => supplier.name.toLowerCase() === name.toLowerCase()
  );

  if (!name) {
    renderSuppliers("Supplier name is required.");
    return;
  }

  if (!phone && !email) {
    renderSuppliers("Enter a phone number or email for this supplier.");
    return;
  }

  if (duplicateSupplier) {
    renderSuppliers("A supplier with this name already exists.");
    return;
  }

  state.suppliers.push({
    name,
    contactPerson,
    phone,
    email,
    address,
    notes
  });

  saveState();
  renderSuppliers();
}
