export const ERROR_FLAGS = Object.freeze({
  SEVERITY_INFO: "info",
  SEVERITY_WARNING: "warning",
  SEVERITY_ERROR: "error",
  SOURCE_AUTH: "auth",
  SOURCE_FIRESTORE: "firestore",
  SOURCE_FUNCTIONS: "functions",
  SOURCE_VALIDATION: "validation",
  SOURCE_SYNC: "sync",
  SOURCE_APP: "app"
});

const firebaseAuthMessages = {
  "auth/invalid-email": "Enter a valid staff email address.",
  "auth/invalid-credential": "The email or password is incorrect.",
  "auth/user-disabled": "This staff account has been disabled. Contact an administrator.",
  "auth/user-not-found": "No staff account was found for this email.",
  "auth/wrong-password": "The email or password is incorrect.",
  "auth/too-many-requests": "Too many failed attempts. Wait a few minutes before trying again.",
  "auth/network-request-failed": "Unable to reach Firebase. Check your internet connection and try again.",
  "auth/requires-recent-login": "Please sign out and sign back in before changing your password.",
  "auth/weak-password": "Use a stronger password with at least 6 characters."
};

const firestoreMessages = {
  "permission-denied": "You do not have permission to complete this action.",
  unauthenticated: "Your session has expired. Sign in again to continue.",
  unavailable: "Firestore is temporarily unavailable. Check your connection and try again.",
  "deadline-exceeded": "Firestore is taking too long to respond. Try again shortly.",
  "not-found": "The requested record was not found.",
  "already-exists": "This record already exists.",
  "failed-precondition": "This action cannot be completed until the required setup is finished.",
  "resource-exhausted": "Firebase is temporarily limiting requests. Wait a moment and try again."
};

const callableMessages = {
  unauthenticated: "Your session has expired. Sign in again to continue.",
  "permission-denied": "You do not have permission to complete this action.",
  unavailable: "The secure account service is temporarily unavailable. Try again shortly.",
  "deadline-exceeded": "The secure account service is taking too long to respond. Try again shortly.",
  invalid_argument: "Some staff account details are missing or invalid."
};

function getErrorCode(error) {
  return error?.code || error?.details?.code || error?.customData?.code || "";
}

function getCallableDetailsMessage(error) {
  const detailsMessage = error?.details?.message || error?.details?.error?.message;
  return typeof detailsMessage === "string" && detailsMessage.trim()
    ? detailsMessage.trim()
    : "";
}

function isRetryableCode(code) {
  return [
    "auth/network-request-failed",
    "unavailable",
    "deadline-exceeded",
    "resource-exhausted"
  ].includes(code);
}

export function createAppError(message, options = {}) {
  const error = new Error(message);

  // These flags are intentionally plain properties so console logs and support
  // screenshots show enough context without needing to inspect stack traces.
  error.code = options.code || "app/error";
  error.source = options.source || ERROR_FLAGS.SOURCE_APP;
  error.severity = options.severity || ERROR_FLAGS.SEVERITY_ERROR;
  error.retryable = options.retryable === true;
  error.userMessage = message;

  if (options.cause) {
    error.cause = options.cause;
  }

  return error;
}

export function toUserMessage(error, fallbackMessage = "Something went wrong. Please try again.") {
  if (typeof error?.userMessage === "string" && error.userMessage.trim()) {
    return error.userMessage;
  }

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
}

export function normalizeFirebaseError(error, fallbackMessage, options = {}) {
  if (error?.userMessage) {
    return error;
  }

  const code = getErrorCode(error);
  const source = options.source || (
    code.startsWith("auth/")
      ? ERROR_FLAGS.SOURCE_AUTH
      : ERROR_FLAGS.SOURCE_FIRESTORE
  );
  const callableMessage = source === ERROR_FLAGS.SOURCE_FUNCTIONS
    ? getCallableDetailsMessage(error)
    : "";
  const message = callableMessage ||
    firebaseAuthMessages[code] ||
    firestoreMessages[code] ||
    callableMessages[code] ||
    fallbackMessage;

  return createAppError(message, {
    code: code || options.code || "firebase/error",
    source,
    retryable: isRetryableCode(code),
    severity: options.severity || ERROR_FLAGS.SEVERITY_ERROR,
    cause: error
  });
}

export function logAppError(context, error) {
  const flags = {
    code: error?.code || "unknown",
    source: error?.source || ERROR_FLAGS.SOURCE_APP,
    retryable: error?.retryable === true,
    severity: error?.severity || ERROR_FLAGS.SEVERITY_ERROR
  };

  console.error(`${context}: ${toUserMessage(error)}`, flags, error);
}
