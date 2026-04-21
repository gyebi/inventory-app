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

function isKnownRole(role) {
  return Object.prototype.hasOwnProperty.call(rolePermissions, role);
}

function extractFirebaseErrorMessage(error, fallbackMessage) {
  if (!error) {
    return fallbackMessage;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  if (typeof error.code === "string" && error.code.trim()) {
    return error.code;
  }

  return fallbackMessage;
}

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
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    throw new Error(extractFirebaseErrorMessage(error, "Unable to sign in with email and password."));
  }
}

export async function logoutUser() {
  await logout();
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function normalizeUserProfile(profile) {
  if (!profile) {
    return null;
  }

  const uid = profile.uid || profile.id || "";
  const fullName = profile.fullName || profile.displayName || profile.name || profile.username || profile.email || "";
  const role = isKnownRole(profile.role) ? profile.role : "sales";
  const active = profile.active !== false && profile.isActive !== false;

  return {
    ...profile,
    id: profile.id || uid,
    uid,
    fullName,
    displayName: profile.displayName || fullName,
    username: profile.username || profile.email || "",
    email: profile.email || "",
    role,
    active,
    isActive: active
  };
}

export function validateSessionProfile(profile) {
  const normalizedProfile = normalizeUserProfile(profile);

  if (!normalizedProfile?.uid) {
    throw new Error("User profile is incomplete.");
  }

  if (!normalizedProfile.active) {
    throw new Error("This account has been deactivated");
  }

  if (!isKnownRole(normalizedProfile.role)) {
    throw new Error("This account does not have a valid role assigned.");
  }

  return normalizedProfile;
}

function buildSessionUser(profile) {
  return profile
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
}

export function setSessionUser(profile) {
  const normalizedProfile = normalizeUserProfile(profile);
  const state = getState();
  state.sessionUser = normalizedProfile;
  state.user = buildSessionUser(normalizedProfile);
  setState(state);
}

export function getSessionUser() {
  return getState().sessionUser;
}
