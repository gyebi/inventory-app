export const PASSWORD_RESET_SUCCESS_MESSAGE = "If an account exists for this email, you’ll receive a password reset link.";

export function validatePasswordResetEmail(value) {
  const email = String(value || "").trim().toLowerCase();

  if (!email) {
    return { valid: false, email: "", message: "Enter your staff email address." };
  }

  // Firebase performs the authoritative validation. This prevents needless
  // requests for clearly malformed input without attempting account lookup.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, email, message: "Enter a valid staff email address." };
  }

  return { valid: true, email, message: "" };
}

export function getPasswordResetResult(error) {
  const code = error?.code || "";

  // Firebase projects without email-enumeration protection can return this
  // code. Treat it exactly like delivery so the UI never reveals membership.
  if (!error || code === "auth/user-not-found") {
    return { type: "success", message: PASSWORD_RESET_SUCCESS_MESSAGE };
  }

  if (code === "auth/too-many-requests") {
    return {
      type: "error",
      message: "Too many reset requests. Please wait a few minutes before trying again."
    };
  }

  if (code === "auth/network-request-failed") {
    return {
      type: "error",
      message: "Unable to request a reset link right now. Check your connection and try again."
    };
  }

  return {
    type: "error",
    message: "Unable to request a reset link right now. Please try again later."
  };
}
