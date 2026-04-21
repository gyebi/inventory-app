"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const ALLOWED_ROLES = new Set(["admin", "manager", "sales", "storekeeper"]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function ensureString(value, fieldName) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    throw new HttpsError("invalid-argument", `${fieldName} is required.`);
  }

  return normalized;
}

function ensureRole(value) {
  const role = String(value || "").trim().toLowerCase();

  if (!ALLOWED_ROLES.has(role)) {
    throw new HttpsError("invalid-argument", "role must be one of admin, manager, sales, or storekeeper.");
  }

  return role;
}

async function getCallerProfile(uid) {
  const snapshot = await db.collection("users").doc(uid).get();

  if (!snapshot.exists) {
    throw new HttpsError("permission-denied", "Caller profile not found.");
  }

  return {
    uid: snapshot.id,
    ...snapshot.data()
  };
}

async function ensureUniqueUsernameWithinUsers(username, existingUid = null) {
  if (!username) {
    return;
  }

  const snapshot = await db
    .collection("users")
    .where("username", "==", username)
    .limit(2)
    .get();

  const conflictingDoc = snapshot.docs.find((doc) => doc.id !== existingUid);

  if (conflictingDoc) {
    throw new HttpsError("already-exists", "A user with this username already exists.");
  }
}

exports.createStaffUser = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to create staff users.");
  }

  const callerProfile = await getCallerProfile(request.auth.uid);

  if (callerProfile.role !== "admin") {
    throw new HttpsError("permission-denied", "Only admin users can create staff accounts.");
  }

  const payload = request.data?.staff || {};
  const fullName = ensureString(payload.fullName, "fullName");
  const email = normalizeEmail(ensureString(payload.email, "email"));
  const username = normalizeUsername(payload.username);
  const role = ensureRole(payload.role);
  const active = payload.active !== false;
  const temporaryPassword = String(payload.temporaryPassword || "").trim();

  await ensureUniqueUsernameWithinUsers(username);

  let existingUser = null;

  try {
    existingUser = await admin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      logger.error("Failed to check existing auth user", error);
      throw new HttpsError("internal", "Unable to validate the target email address.");
    }
  }

  if (existingUser) {
    throw new HttpsError("already-exists", "A Firebase Auth user with this email already exists.");
  }

  const userRecord = await admin.auth().createUser({
    email,
    password: temporaryPassword || undefined,
    displayName: fullName,
    disabled: !active
  });

  const userDoc = {
    uid: userRecord.uid,
    fullName,
    email,
    username,
    role,
    active,
    pendingAuthCreation: false,
    authProvider: "password",
    mustChangePassword: Boolean(temporaryPassword),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: {
      uid: callerProfile.uid,
      fullName: callerProfile.fullName || callerProfile.username || callerProfile.email || callerProfile.uid,
      email: callerProfile.email || "",
      role: callerProfile.role || "admin"
    }
  };

  await db.collection("users").doc(userRecord.uid).set(userDoc, { merge: true });

  return {
    ok: true,
    user: {
      uid: userRecord.uid,
      fullName,
      email,
      username,
      role,
      active,
      pendingAuthCreation: false
    }
  };
});
