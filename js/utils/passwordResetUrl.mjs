const DEFAULT_LOCAL_ORIGIN = "http://127.0.0.1:5173";

/** @param {string} message */
function invalidConfiguration(message) {
  const error = new Error(message);
  /** @type {Error & { code?: string }} */ (error).code = "auth/password-reset-configuration";
  return error;
}

function normalizeProjectId(projectId) {
  const normalized = String(projectId || "").trim();

  if (!/^[a-z][a-z0-9-]{4,62}$/.test(normalized)) {
    throw invalidConfiguration("A valid Firebase project ID is required for password reset links.");
  }

  return normalized;
}

function parseOrigin(value, { allowLoopback }) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw invalidConfiguration("The password reset continue URL must be a valid application origin.");
  }

  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const isSecure = url.protocol === "https:";

  if ((!isSecure && !(allowLoopback && isLoopback && url.protocol === "http:")) || url.username || url.password) {
    throw invalidConfiguration("The password reset continue URL must use HTTPS or an approved local emulator origin.");
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw invalidConfiguration("The password reset continue URL must be an application origin without a path, query, or fragment.");
  }

  return url.origin;
}

/**
 * Returns a fixed, environment-derived continue URL for Firebase's hosted
 * password-reset handler. It deliberately accepts no value from the page URL
 * or form data, so a reset request cannot become an open redirect.
 */
/**
 * @param {{ mode?: string, projectId?: string }} options
 */
export function getPasswordResetContinueUrl({ mode = "production", projectId } = {}) {
  const normalizedMode = String(mode || "production").trim();
  const isEmulator = normalizedMode === "emulator";
  const origin = isEmulator
    ? DEFAULT_LOCAL_ORIGIN
    : `https://${normalizeProjectId(projectId)}.web.app`;

  return `${parseOrigin(origin, { allowLoopback: isEmulator })}/`;
}
