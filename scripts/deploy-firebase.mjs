import { execFileSync } from "node:child_process";

export const PRODUCTION_PROJECT_ID = "inventory-app-19d04";
const ALLOWED_SCOPES = new Set(["hosting", "functions", "firestore:rules"]);

export function validateDeploymentRequest(environment, scope, environmentVariables = process.env) {
  if (environment === "emulator") {
    throw new Error("Emulator mode cannot be deployed.");
  }

  if (!new Set(["staging", "production"]).has(environment) || !ALLOWED_SCOPES.has(scope)) {
    throw new Error("Usage: node scripts/deploy-firebase.mjs <staging|production> <hosting|functions|firestore:rules>");
  }

  const projectId = environment === "production"
    ? PRODUCTION_PROJECT_ID
    : String(environmentVariables.FIREBASE_STAGING_PROJECT_ID || "").trim();

  if (!projectId) {
    throw new Error("FIREBASE_STAGING_PROJECT_ID is required for staging deployment.");
  }

  if (environment === "staging" && projectId === PRODUCTION_PROJECT_ID) {
    throw new Error("Refusing to deploy staging to the production Firebase project.");
  }

  if (environment === "production" && environmentVariables.JYAANO_ALLOW_PRODUCTION_DEPLOY !== "yes") {
    throw new Error("Production deployment requires JYAANO_ALLOW_PRODUCTION_DEPLOY=yes after manual approval.");
  }

  return projectId;
}

function main() {
  const [environment, scope] = process.argv.slice(2);
  const projectId = validateDeploymentRequest(environment, scope);
  const deploymentEnvironment = {
    ...process.env,
    JYAANO_HOSTING_DEPLOY_ENV: environment,
    JYAANO_HOSTING_DEPLOY_PROJECT_ID: projectId
  };

  console.log(`Deploying ${scope} to explicitly selected ${environment} project ${projectId}.`);
  execFileSync("firebase", ["deploy", "--project", projectId, "--only", scope], {
    env: deploymentEnvironment,
    stdio: "inherit"
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
