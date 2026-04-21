import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";

const CREATE_STAFF_USER_FUNCTION = "createStaffUser";

export async function createStaffUserAccount(payload) {
  const callable = httpsCallable(functions, CREATE_STAFF_USER_FUNCTION);
  const result = await callable(payload);

  return result?.data || null;
}
