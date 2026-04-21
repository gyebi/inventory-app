"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();

const ALLOWED_ROLES = new Set(["admin", "manager", "sales", "storekeeper"]);
const ALLOWED_ORIGINS = [
  "https://inventory-app-19d04.web.app",
  "https://inventory-app-19d04.firebaseapp.com"
];
const DEFAULT_PASSWORD_SETUP_URL = ALLOWED_ORIGINS[0];

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

function resolvePasswordSetupUrl(candidateUrl) {
  const normalizedUrl = String(candidateUrl || "").trim();

  if (!normalizedUrl) {
    return DEFAULT_PASSWORD_SETUP_URL;
  }

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (!ALLOWED_ORIGINS.includes(parsedUrl.origin)) {
      throw new Error("origin-not-allowed");
    }

    return parsedUrl.toString();
  } catch (error) {
    throw new HttpsError("invalid-argument", "passwordSetupUrl must use an allowed application origin.");
  }
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

async function findPendingUserByEmail(email) {
  const snapshot = await db
    .collection("users")
    .where("email", "==", email)
    .limit(5)
    .get();

  return snapshot.docs.find((doc) => doc.data()?.pendingAuthCreation === true) || null;
}

async function deletePendingUserDoc(snapshot) {
  if (!snapshot?.exists) {
    return;
  }

  await snapshot.ref.delete();
}

async function findUserDocsByEmail(email) {
  const snapshot = await db
    .collection("users")
    .where("email", "==", email)
    .limit(10)
    .get();

  return snapshot.docs;
}

function selectUserDocForMigration(userDocs = [], uid) {
  const matchingUidDoc = userDocs.find((doc) => doc.id === uid);

  if (matchingUidDoc) {
    return matchingUidDoc;
  }

  const pendingDoc = userDocs.find((doc) => doc.data()?.pendingAuthCreation === true);

  if (pendingDoc) {
    return pendingDoc;
  }

  if (userDocs.length === 1) {
    return userDocs[0];
  }

  return null;
}

exports.createStaffUser = onCall({ cors: ALLOWED_ORIGINS }, async (request) => {
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
  const pendingUserSnapshot = await findPendingUserByEmail(email);
  const role = ensureRole(payload.role);
  const active = payload.active !== false;
  const temporaryPassword = String(payload.temporaryPassword || "").trim();
  const passwordSetupUrl = resolvePasswordSetupUrl(payload.passwordSetupUrl);
  const credentialSetupMode = temporaryPassword ? "temporary_password" : "setup_link";

  await ensureUniqueUsernameWithinUsers(username, pendingUserSnapshot?.id || null);

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

  let passwordSetupLink = null;

  if (!temporaryPassword) {
    try {
      passwordSetupLink = await admin.auth().generatePasswordResetLink(email, {
        url: passwordSetupUrl
      });
    } catch (error) {
      logger.error("Failed to generate password setup link", error);
      await admin.auth().deleteUser(userRecord.uid);
      throw new HttpsError("internal", "Unable to generate the password setup link for this staff account.");
    }
  }

  const userDoc = {
    uid: userRecord.uid,
    fullName,
    email,
    username,
    role,
    active,
    pendingAuthCreation: false,
    authProvider: "password",
    mustChangePassword: true,
    credentialSetupMode,
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
  await deletePendingUserDoc(pendingUserSnapshot);

  return {
    ok: true,
    user: {
      uid: userRecord.uid,
      fullName,
      email,
      username,
      role,
      active,
      pendingAuthCreation: false,
      mustChangePassword: true,
      credentialSetupMode,
      passwordSetupLink
    }
  };
});

exports.ensureSignedInUserProfile = onCall({ cors: ALLOWED_ORIGINS }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const uid = request.auth.uid;
  const userRecord = await admin.auth().getUser(uid);
  const email = normalizeEmail(userRecord.email);

  if (!email) {
    throw new HttpsError("failed-precondition", "Signed-in user does not have an email address.");
  }

  const canonicalRef = db.collection("users").doc(uid);
  const canonicalSnapshot = await canonicalRef.get();

  if (canonicalSnapshot.exists) {
    return {
      ok: true,
      user: {
        uid,
        ...canonicalSnapshot.data()
      }
    };
  }

  const userDocs = await findUserDocsByEmail(email);
  const sourceSnapshot = selectUserDocForMigration(userDocs, uid);

  if (!sourceSnapshot) {
    throw new HttpsError("not-found", "No matching Firestore user profile was found for this email.");
  }

  const sourceData = sourceSnapshot.data() || {};
  const migratedDoc = {
    ...sourceData,
    uid,
    email,
    fullName: sourceData.fullName || userRecord.displayName || email,
    username: sourceData.username || "",
    active: sourceData.active !== false,
    pendingAuthCreation: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await canonicalRef.set(migratedDoc, { merge: true });

  if (sourceSnapshot.id !== uid) {
    await sourceSnapshot.ref.delete();
  }

  return {
    ok: true,
    user: {
      uid,
      ...migratedDoc,
      updatedAt: undefined
    }
  };
});
