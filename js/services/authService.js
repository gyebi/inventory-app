import { getState, setState } from "../state.js";

const rolePermissions = {
  admin: ["all"],
  sales: ["create_sale", "view_dashboard"],
  storekeeper: [
    "add_product",
    "manage_stock"
  ],
  manager: ["view_dashboard", "view_reports", "manage_stock"]
};

export const login = (username, password) => {
  const state = getState();

  const user = state.users?.find(
    (u) => u.username === username && u.password === password
  );

  if (!user) {
    throw new Error("Invalid credentials");
  }

  if (user.active === false) {
    throw new Error("This user account is inactive");
  }

  state.user = {
    id: user.id || user.username,
    fullName: user.fullName || user.username,
    username: user.username,
    role: user.role
  };
  setState(state);

  return state.user;
};

export const logout = () => {
  const state = getState();
  state.user = null;
  setState(state);
};

export const getCurrentUser = () => {
  return getState().user;
};

export const isAuthenticated = () => {
  return Boolean(getCurrentUser());
};

export const hasRole = (role) => {
  return getCurrentUser()?.role === role;
};

export const hasAnyRole = (roles = []) => {
  const currentRole = getCurrentUser()?.role;
  return roles.includes(currentRole);
};

export const hasPermission = (action) => {
  const user = getCurrentUser();

  if (!user) {
    return false;
  }

  const permissions = rolePermissions[user.role] || [];

  return permissions.includes("all") || permissions.includes(action);
};

export const requireRole = (roles = []) => {
  if (!isAuthenticated()) {
    throw new Error("Login required");
  }

  if (!hasAnyRole(Array.isArray(roles) ? roles : [roles])) {
    throw new Error("Access denied");
  }
};

export const requirePermission = (action) => {
  if (!isAuthenticated()) {
    throw new Error("Login required");
  }

  if (!hasPermission(action)) {
    throw new Error("Access denied");
  }
};
