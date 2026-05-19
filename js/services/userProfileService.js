import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase.js";
import { createAppError, ERROR_FLAGS } from "../utils/errorUtils.js";

const ENSURE_SIGNED_IN_USER_PROFILE_FUNCTION = "ensureSignedInUserProfile";
const CLEAR_REQUIRED_PASSWORD_CHANGE_FUNCTION = "clearRequiredPasswordChange";

export async function getUserProfile(uid) {
  if (!uid) {
    throw createAppError("Unable to load your staff profile because the sign-in session is incomplete.", {
      code: "auth/missing-user-id",
      source: ERROR_FLAGS.SOURCE_AUTH
    });
  }

  const userRef = doc(db, "users", uid);
  let snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    await ensureSignedInUserProfile();
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

async function ensureSignedInUserProfile() {
  const callable = httpsCallable(functions, ENSURE_SIGNED_IN_USER_PROFILE_FUNCTION);
  await callable({});
}

export async function clearRequiredPasswordChange() {
  const callable = httpsCallable(functions, CLEAR_REQUIRED_PASSWORD_CHANGE_FUNCTION);
  const result = await callable({});
  return result?.data?.user || null;
}
