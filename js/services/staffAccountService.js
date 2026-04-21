import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase.js";

const CREATE_STAFF_USER_FUNCTION = "createStaffUser";

function extractCallableErrorMessage(error) {
  if (!error) {
    return "Unable to create the staff account.";
  }

  const callableMessage = error.details?.message || error.details?.error?.message;

  if (typeof callableMessage === "string" && callableMessage.trim()) {
    return callableMessage;
  }

  if (typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  if (typeof error.code === "string" && error.code.trim()) {
    return error.code;
  }

  return "Unable to create the staff account.";
}

export async function createStaffUserAccount(payload) {
  try {
    const callable = httpsCallable(functions, CREATE_STAFF_USER_FUNCTION);
    const result = await callable(payload);

    return result?.data || null;
  } catch (error) {
    throw new Error(extractCallableErrorMessage(error));
  }
}
