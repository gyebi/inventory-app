"use strict";

const PRODUCTION_ORIGINS = [
  "https://inventory-app-19d04.web.app",
  "https://inventory-app-19d04.firebaseapp.com"
];
const DEMO_EMULATOR_PROJECT_ID = "demo-jyaano";

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => {
      try {
        return new URL(origin).origin === origin;
      } catch {
        return false;
      }
    });
}

function getAllowedOrigins(environment = process.env) {
  const deploymentEnvironment = String(environment.JYAANO_DEPLOYMENT_ENV || "production").trim();
  const configuredOrigins = parseOrigins(environment.FUNCTIONS_ALLOWED_ORIGINS);

  if (deploymentEnvironment === "emulator") {
    if (String(environment.GCLOUD_PROJECT || "").trim() !== DEMO_EMULATOR_PROJECT_ID) {
      throw new Error(`Local Functions emulator must use ${DEMO_EMULATOR_PROJECT_ID}.`);
    }

    if (configuredOrigins.length === 0 || configuredOrigins.some((origin) => !isLoopbackOrigin(origin))) {
      throw new Error("Local Functions emulator requires explicit loopback FUNCTIONS_ALLOWED_ORIGINS.");
    }

    return configuredOrigins;
  }

  if (deploymentEnvironment === "staging") {
    if (configuredOrigins.length === 0) {
      throw new Error("Staging Functions require explicit FUNCTIONS_ALLOWED_ORIGINS.");
    }

    if (configuredOrigins.some((origin) => PRODUCTION_ORIGINS.includes(origin))) {
      throw new Error("Staging Functions must not allow production origins.");
    }

    return configuredOrigins;
  }

  return configuredOrigins.length > 0 ? configuredOrigins : PRODUCTION_ORIGINS;
}

module.exports = {
  DEMO_EMULATOR_PROJECT_ID,
  PRODUCTION_ORIGINS,
  getAllowedOrigins,
  isLoopbackOrigin,
  parseOrigins
};
