import {
  assertHostingArtifactMatchesDeployment,
  readHostingArtifact
} from "./hosting-artifact.mjs";

const environment = String(process.env.JYAANO_HOSTING_DEPLOY_ENV || "").trim();
const projectId = String(process.env.JYAANO_HOSTING_DEPLOY_PROJECT_ID || "").trim();

if (environment === "emulator") {
  throw new Error("Emulator mode cannot be deployed.");
}

if (!environment || !projectId) {
  throw new Error("Hosting deployment must be started through scripts/deploy-firebase.mjs with an explicit environment and target.");
}

const artifact = readHostingArtifact();
assertHostingArtifactMatchesDeployment(artifact, environment, projectId);
console.log(`PASS: ${environment} Hosting artifact matches deployment target ${projectId}.`);
