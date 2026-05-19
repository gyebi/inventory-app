import { getState, setState } from "../state.js";
// js/services/authService.js
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword
} from "firebase/auth";
import { auth } from "../firebase.js";
import {
  createAppError,
  ERROR_FLAGS,
  normalizeFirebaseError
} from "../utils/errorUtils.js";


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
    throw createAppError("Sign in before opening this page.", {
      code: "auth/login-required",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  if (!hasAnyRole(Array.isArray(roles) ? roles : [roles])) {
    throw createAppError("You do not have permission to open this page.", {
      code: "auth/access-denied",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }
};

export const requirePermission = (action) => {
  if (!isAuthenticated()) {
    throw createAppError("Sign in before opening this page.", {
      code: "auth/login-required",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  if (!hasPermission(action)) {
    throw createAppError("You do not have permission to complete this action.", {
      code: "auth/access-denied",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }
};


//new log in wiring to firebase 
export async function loginWithEmail(email, password) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return userCredential.user;
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to sign in. Check the email and password, then try again.", {
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }
}

export async function logoutUser() {
  await logout();
}

export function observeAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function updateCurrentUserPassword(newPassword) {
  if (!auth.currentUser) {
    throw createAppError("Sign in again before changing your password.", {
      code: "auth/no-current-user",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  try {
    await updatePassword(auth.currentUser, newPassword);
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to update the password. Check the new password and try again.", {
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }
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
    throw createAppError("Your staff profile is incomplete. Ask an administrator to review your account.", {
      code: "auth/profile-incomplete",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  if (!normalizedProfile.active) {
    throw createAppError("This account has been deactivated. Contact an administrator.", {
      code: "auth/account-deactivated",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  if (!isKnownRole(normalizedProfile.role)) {
    throw createAppError("This account does not have a valid role assigned. Ask an administrator to update it.", {
      code: "auth/invalid-role",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  return normalizedProfile;
}

export function isPasswordChangeRequired(profile) {
  const normalizedProfile = normalizeUserProfile(profile);
  return normalizedProfile?.mustChangePassword === true;
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
