const PRINTER_ERROR_CODES = Object.freeze({
  BRIDGE_OFFLINE: "bridge-offline",
  PRINTER_NOT_CONFIGURED: "printer-not-configured",
  PRINTER_NOT_FOUND: "printer-not-found",
  PRINTER_OFFLINE: "printer-offline",
  DRIVER_ERROR: "driver-error",
  PERMISSION_DENIED: "permission-denied",
  PRINT_JOB_FAILED: "print-job-failed",
  PRINT_RESULT_UNKNOWN: "print-result-unknown",
  PRINT_JOB_IN_PROGRESS: "print-job-in-progress",
  PRINTER_DISCOVERY_FAILED: "printer-discovery-failed",
  UNSUPPORTED_PLATFORM: "unsupported-platform",
});

function createPrinterError(code, message, options = {}) {
  const error = new Error(message);
  error.code = code;

  if (options.cause) {
    error.cause = options.cause;
  }

  if (options.details) {
    error.details = options.details;
  }

  return error;
}

function getPrinterErrorCode(error, fallback = PRINTER_ERROR_CODES.PRINT_JOB_FAILED) {
  return Object.values(PRINTER_ERROR_CODES).includes(error?.code)
    ? error.code
    : fallback;
}

function toPrinterErrorPayload(error, fallbackMessage = "Printer request failed") {
  return {
    error: error?.message || fallbackMessage,
    errorCode: getPrinterErrorCode(error),
    details: error?.details || undefined,
  };
}

module.exports = {
  PRINTER_ERROR_CODES,
  createPrinterError,
  getPrinterErrorCode,
  toPrinterErrorPayload,
};
