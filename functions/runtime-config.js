"use strict";

const PRODUCTION_ORIGINS = [
  "https://inventory-app-19d04.web.app",
  "https://inventory-app-19d04.firebaseapp.com"
];

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
  PRODUCTION_ORIGINS,
  getAllowedOrigins,
  parseOrigins
};
