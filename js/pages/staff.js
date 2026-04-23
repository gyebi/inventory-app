import { createStaffUserAccount } from "../services/staffAccountService.js";

const CLOUD_SAVE_TIMEOUT_MS = 20000;

const { renderPage, saveState, state } = window.app;

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "sales", label: "Sales" },
  { value: "storekeeper", label: "Storekeeper" }
];

function renderStaff(error = "", values = {}, success = "") {
  const staffRows = state.users.length === 0
    ? `<div class="card">No staff users saved yet.</div>`
    : `<div class="inventory-list">${state.users.map((user) => `
        <div class="inventory-row">
          <div><strong>Name:</strong> ${user.fullName || user.email || user.username || "N/A"}</div>
          <div><strong>Email:</strong> ${user.email || "N/A"}</div>
          <div><strong>Username:</strong> ${user.username || "N/A"}</div>
          <div><strong>Role:</strong> ${formatRole(user.role)}</div>
          <div><strong>Status:</strong> ${user.active === false ? "Inactive" : "Active"}</div>
          <div><strong>Auth:</strong> ${user.pendingAuthCreation ? "Pending backend setup" : "Ready"}</div>
        </div>
      `).join("")}</div>`;

  renderPage(`
    <div class="page-title">
      <h2>Staff Onboarding</h2>
      <p>Add real staff accounts and assign their access role.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}
    ${success ? `<div class="message success">${success}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="staffFullName">Full Name</label>
        <input id="staffFullName" value="${values.fullName || ""}">
      </div>

      <div class="form-row">
        <label for="staffEmail">Email</label>
        <input id="staffEmail" type="email" value="${values.email || ""}">
      </div>

      <div class="form-row">
        <label for="staffUsername">Username (Optional)</label>
        <input id="staffUsername" value="${values.username || ""}">
      </div>

      <div class="form-row">
        <label for="staffTempPassword">Temporary Password (Optional)</label>
        <input id="staffTempPassword" type="password" value="${values.tempPassword || ""}">
      </div>

      <div class="form-row">
        <label for="staffRole">Role</label>
        <select id="staffRole">
          ${roleOptions.map((role) => `
            <option value="${role.value}" ${values.role === role.value ? "selected" : ""}>${role.label}</option>
          `).join("")}
        </select>
      </div>

      <div class="form-row">
        <label for="staffActive">Status</label>
        <select id="staffActive">
          <option value="true" ${values.active !== "false" ? "selected" : ""}>Active</option>
          <option value="false" ${values.active === "false" ? "selected" : ""}>Inactive</option>
        </select>
      </div>

      <button id="addStaffButton" onclick="addStaffUser()">Add Staff</button>
    </div>

    <div class="card">
      Staff accounts must be created through the secure backend so Firebase Auth and Firestore stay in sync.
    </div>

    <h3>Staff Users</h3>
    ${staffRows}
  `);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createUserId(email) {
  return `user_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function setStaffProcessing(isProcessing) {
  const button = document.getElementById("addStaffButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.innerHTML = isProcessing
    ? `<span class="button-spinner" aria-hidden="true"></span>Saving staff...`
    : "Add Staff";
}

async function addStaffUser() {
  const fullName = document.getElementById("staffFullName").value.trim();
  const email = document.getElementById("staffEmail").value.trim().toLowerCase();
  const username = document.getElementById("staffUsername").value.trim();
  const tempPassword = document.getElementById("staffTempPassword").value.trim();
  const role = document.getElementById("staffRole").value;
  const active = document.getElementById("staffActive").value;
  const values = {
    fullName,
    email,
    username,
    tempPassword,
    role,
    active
  };

  if (!fullName) {
    renderStaff("Enter the staff member's full name.", values);
    return;
  }

  if (!email) {
    renderStaff("Enter an email address for this staff member.", values);
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    renderStaff("Enter a valid email address for this staff member.", values);
    return;
  }

  if (tempPassword && tempPassword.length < 6) {
    renderStaff("Temporary password must be at least 6 characters.", values);
    return;
  }

  const existingEmailUser = state.users.find((user) => (user.email || "").toLowerCase() === email);

  if (existingEmailUser && existingEmailUser.pendingAuthCreation !== true) {
    renderStaff("A staff user with this email already exists.", values);
    return;
  }

  const existingUsernameUser = username
    ? state.users.find((user) => (user.username || "").toLowerCase() === username.toLowerCase())
    : null;

  if (existingUsernameUser && existingUsernameUser.pendingAuthCreation !== true) {
    renderStaff("A staff user with this username already exists.", values);
    return;
  }

  const currentUser = state.user;
  const staffUser = {
    id: createUserId(email),
    fullName,
    email,
    username,
    role,
    active: active === "true",
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
    setStaffProcessing(true);
    const backendResult = await tryCreateStaffUserWithBackend(staffUser, tempPassword);
    const createdUser = normalizeCreatedStaffUser(staffUser, backendResult);
    const successMessage = buildStaffCreationSuccessMessage(backendResult);

    upsertLocalStaffUser(createdUser, existingEmailUser, existingUsernameUser);
    saveState();
    renderStaff("", {}, successMessage);
  } catch (error) {
    setStaffProcessing(false);
    renderStaff(error.message || "Unable to create the staff account securely.", values);
    return;
  }
}

function formatRole(role) {
  return roleOptions.find((option) => option.value === role)?.label || role || "N/A";
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeout
  ]);
}

async function tryCreateStaffUserWithBackend(staffUser, tempPassword = "") {
  const result = await withTimeout(
    createStaffUserAccount({
      staff: {
        fullName: staffUser.fullName,
        email: staffUser.email,
        username: staffUser.username,
        role: staffUser.role,
        active: staffUser.active,
        temporaryPassword: tempPassword || undefined
      }
    }),
    CLOUD_SAVE_TIMEOUT_MS,
    "The secure staff account creation function is taking too long to respond."
  );

  if (!result?.ok || !result?.user?.uid) {
    throw new Error("Secure staff account creation did not complete successfully.");
  }

  return result;
}

function normalizeCreatedStaffUser(staffUser, backendResult) {
  return {
    ...staffUser,
    id: backendResult.user.uid || backendResult.user.id || staffUser.id,
    uid: backendResult.user.uid,
    active: backendResult.user.active !== false,
    mustChangePassword: backendResult.user.mustChangePassword === true,
    credentialSetupMode: backendResult.user.credentialSetupMode || "temporary_password",
    pendingAuthCreation: false,
    createdAt: backendResult.user.createdAt || staffUser.createdAt
  };
}

function buildStaffCreationSuccessMessage(backendResult) {
  const setupMode = backendResult?.user?.credentialSetupMode;
  const setupLink = backendResult?.user?.passwordSetupLink;

  if (setupMode === "setup_link" && setupLink) {
    const escapedLink = escapeHtml(setupLink);

    return `Staff account created securely. Share this password setup link with the staff member: <a href="${escapedLink}" target="_blank" rel="noopener noreferrer">Open setup link</a>`;
  }

  return "Staff account created through the secure backend. The user must sign in with their email and temporary password, then change that password before using the app.";
}

function upsertLocalStaffUser(createdUser, existingEmailUser, existingUsernameUser) {
  const existingId = existingEmailUser?.id || existingUsernameUser?.id;
  const existingIndex = existingId
    ? state.users.findIndex((user) => user.id === existingId)
    : -1;

  if (existingIndex >= 0) {
    state.users.splice(existingIndex, 1, createdUser);
    return;
  }

  state.users.push(createdUser);
}

window.renderStaff = renderStaff;
window.addStaffUser = addStaffUser;
