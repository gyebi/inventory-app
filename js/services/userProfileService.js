import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase.js";

const ENSURE_SIGNED_IN_USER_PROFILE_FUNCTION = "ensureSignedInUserProfile";
const CLEAR_REQUIRED_PASSWORD_CHANGE_FUNCTION = "clearRequiredPasswordChange";

export async function getUserProfile(uid) {
  if (!uid) {
    throw new Error("Missing user UID");
  }

  const userRef = doc(db, "users", uid);
  let snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    await ensureSignedInUserProfile();
    snapshot = await getDoc(userRef);
  }

  if (!snapshot.exists()) {
    throw new Error("User profile not found");
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
