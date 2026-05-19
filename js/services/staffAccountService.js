import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";
import {
  ERROR_FLAGS,
  normalizeFirebaseError
} from "../utils/errorUtils.js";

const CREATE_STAFF_USER_FUNCTION = "createStaffUser";

export async function createStaffUserAccount(payload) {
  try {
    const callable = httpsCallable(functions, CREATE_STAFF_USER_FUNCTION);
    const result = await callable(payload);

    return result?.data || null;
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to create the staff account. Check the details and try again.", {
      source: ERROR_FLAGS.SOURCE_FUNCTIONS
    });
  }
}
