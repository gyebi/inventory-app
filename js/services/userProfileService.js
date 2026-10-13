import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "../firebase.js";
import { createUserProfileService } from "./userProfileServiceCore.js";

const CLEAR_REQUIRED_PASSWORD_CHANGE_FUNCTION = "clearRequiredPasswordChange";

export const { getUserProfile } = createUserProfileService({
  auth,
  db,
  doc,
  getDoc,
  functions,
  httpsCallable
});

export async function clearRequiredPasswordChange() {
  const callable = httpsCallable(functions, CLEAR_REQUIRED_PASSWORD_CHANGE_FUNCTION);
  const result = await callable({});
  return result?.data?.user || null;
}
