import { readFileSync } from "node:fs";

export const PRODUCTION_PROJECT_ID = "inventory-app-19d04";

const REQUIRED_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_FUNCTIONS_REGION"
];

export function parseEnvironmentFile(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator === -1
          ? [line, ""]
          : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      })
  );
}

export function validateFirebaseEnvironment(mode, environment, expectedStagingProjectId = "") {
  if (!new Set(["staging", "production"]).has(mode)) {
    throw new Error("Environment mode must be staging or production.");
  }

  const missing = REQUIRED_KEYS.filter((key) => !String(environment[key] || "").trim());
  if (missing.length > 0) {
    throw new Error(`Missing required Firebase configuration: ${missing.join(", ")}`);
  }

  const projectId = environment.VITE_FIREBASE_PROJECT_ID.trim();

  if (mode === "production" && projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error("Production builds must explicitly use inventory-app-19d04.");
  }

  if (mode === "staging") {
    if (projectId === PRODUCTION_PROJECT_ID) {
      throw new Error("Staging configuration must not target inventory-app-19d04.");
    }

    if (!expectedStagingProjectId) {
      throw new Error("FIREBASE_STAGING_PROJECT_ID is required for a staging build or deployment.");
    }

    if (projectId !== expectedStagingProjectId) {
      throw new Error("VITE_FIREBASE_PROJECT_ID must match FIREBASE_STAGING_PROJECT_ID.");
    }

    for (const key of ["VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_STORAGE_BUCKET"]) {
      if (environment[key].includes(PRODUCTION_PROJECT_ID)) {
        throw new Error(`Staging ${key} must not reference the production project.`);
      }
    }
  }
}

function main() {
  const [mode, environmentFile] = process.argv.slice(2);

  if (!mode || !environmentFile) {
    throw new Error("Usage: node scripts/validate-firebase-environment.mjs <staging|production> <env-file>");
  }

  const environment = parseEnvironmentFile(readFileSync(environmentFile, "utf8"));
  validateFirebaseEnvironment(mode, environment, process.env.FIREBASE_STAGING_PROJECT_ID || "");
  console.log(`PASS: ${mode} Firebase configuration is complete and target-safe.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
