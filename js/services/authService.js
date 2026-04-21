import { getState, setState } from "../state.js";
// js/services/authService.js
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import { auth } from "../firebase.js";


const rolePermissions = {
  admin: ["all"],
  sales: ["create_sale", "view_dashboard"],
  storekeeper: [
    "add_product",
    "manage_stock"
  ],
  manager: ["view_dashboard", "view_reports", "manage_stock"]
};

export const login = async (email, password) => {
  return loginWithEmail(email, password);
};

export const logout = async () => {
  await signOut(auth);
  const state = getState();
  state.user = null;
  state.sessionUser = null;
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


//new log in wiring to firebase 
export async function loginWithEmail(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  return userCredential.user;
}

export async function logoutUser() {
  await logout();
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function setSessionUser(profile) {
  const state = getState();
  state.sessionUser = profile;
  state.user = profile
    ? {
        id: profile.id || profile.uid,
        uid: profile.uid || profile.id,
        fullName: profile.fullName || profile.displayName || profile.username || profile.email,
        username: profile.username || profile.email || "",
        email: profile.email || "",
        role: profile.role || "sales",
        active: profile.active !== false && profile.isActive !== false
      }
    : null;
  setState(state);
}

export function getSessionUser() {
  return getState().sessionUser;
}
