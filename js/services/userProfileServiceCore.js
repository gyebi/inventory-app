import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";

const ENSURE_SIGNED_IN_USER_PROFILE_FUNCTION = "ensureSignedInUserProfile";

function isPermissionDenied(error) {
  return error?.code === "permission-denied" || error?.code === "firestore/permission-denied";
}

export function createUserProfileService({ auth, db, doc, getDoc, functions, httpsCallable }) {
  const pendingInitializations = new Map();

  async function ensureSignedInUserProfile(uid) {
    if (auth.currentUser?.uid !== uid) {
      throw createAppError("Unable to initialize a staff profile for a different sign-in session.", {
        code: "auth/current-user-mismatch",
        source: ERROR_FLAGS.SOURCE_AUTH
      });
    }

    const pendingInitialization = pendingInitializations.get(uid);
    if (pendingInitialization) {
      return pendingInitialization;
    }

    const initialization = (async () => {
      const callable = httpsCallable(functions, ENSURE_SIGNED_IN_USER_PROFILE_FUNCTION);
      await callable({});
    })();

    pendingInitializations.set(uid, initialization);

    try {
      await initialization;
    } finally {
      if (pendingInitializations.get(uid) === initialization) {
        pendingInitializations.delete(uid);
      }
    }
  }

  async function getUserProfile(uid) {
    if (!uid) {
      throw createAppError("Unable to load your staff profile because the sign-in session is incomplete.", {
        code: "auth/missing-user-id",
        source: ERROR_FLAGS.SOURCE_AUTH
      });
    }

    const userRef = doc(db, "users", uid);
    let snapshot;
    let initializationAttempted = false;

    try {
      snapshot = await getDoc(userRef);
    } catch (error) {
      if (!isPermissionDenied(error)) {
        throw error;
      }

      await ensureSignedInUserProfile(uid);
      initializationAttempted = true;
      snapshot = await getDoc(userRef);
    }

    if (!snapshot.exists() && !initializationAttempted) {
      await ensureSignedInUserProfile(uid);
      snapshot = await getDoc(userRef);
    }

    if (!snapshot.exists()) {
      throw createAppError("No staff profile was found for this account. Ask an administrator to finish account setup.", {
        code: "auth/profile-not-found",
        source: ERROR_FLAGS.SOURCE_AUTH
      });
    }

    return {
      uid: snapshot.id,
      ...snapshot.data()
    };
  }

  return { getUserProfile };
}
