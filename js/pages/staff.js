import { saveUserToCloud } from "../services/cloudUserService.js";

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
          <div><strong>Name:</strong> ${user.fullName || user.username}</div>
          <div><strong>Username:</strong> ${user.username}</div>
          <div><strong>Role:</strong> ${formatRole(user.role)}</div>
          <div><strong>Status:</strong> ${user.active === false ? "Inactive" : "Active"}</div>
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
        <label for="staffUsername">Username</label>
        <input id="staffUsername" value="${values.username || ""}">
      </div>

      <div class="form-row">
        <label for="staffPassword">Password</label>
        <input id="staffPassword" type="password" value="${values.password || ""}">
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

    <h3>Staff Users</h3>
    ${staffRows}
  `);
}

function createUserId(username) {
  return `user_${username.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;
}

function setStaffProcessing(isProcessing) {
  const button = document.getElementById("addStaffButton");

  if (!button) {
    return;
  }

  button.disabled = isProcessing;
  button.textContent = isProcessing ? "Saving to Firestore..." : "Add Staff";
}

async function addStaffUser() {
  const fullName = document.getElementById("staffFullName").value.trim();
  const username = document.getElementById("staffUsername").value.trim();
  const password = document.getElementById("staffPassword").value.trim();
  const role = document.getElementById("staffRole").value;
  const active = document.getElementById("staffActive").value;
  const values = {
    fullName,
    username,
    password,
    role,
    active
  };

  if (!fullName) {
    renderStaff("Enter the staff member's full name.", values);
    return;
  }

  if (!username) {
    renderStaff("Enter a username for this staff member.", values);
    return;
  }

  if (!password) {
    renderStaff("Enter a password for this staff member.", values);
    return;
  }

  if (state.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    renderStaff("A staff user with this username already exists.", values);
    return;
  }

  const currentUser = state.user;
  const staffUser = {
    id: createUserId(username),
    fullName,
    username,
    password,
    role,
    active: active === "true",
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
    setStaffProcessing(true);
    await withTimeout(
      saveUserToCloud(staffUser),
      CLOUD_SAVE_TIMEOUT_MS,
      "Firestore is taking too long to create this staff user. Check your internet connection, Firebase config, and Firestore rules before trying again."
    );
  } catch (error) {
    setStaffProcessing(false);
    renderStaff(error.message || "Unable to save staff user to Firestore.", values);
    return;
  }

  state.users.push(staffUser);
  saveState();
  renderStaff("", {}, "Staff user added. They can now login with their username and password.");
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

window.renderStaff = renderStaff;
window.addStaffUser = addStaffUser;
