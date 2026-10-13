import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const HOSTING_ARTIFACT_FILE = ".jyaano-hosting-artifact.json";
export const PRODUCTION_PROJECT_ID = "inventory-app-19d04";

function assertEnvironment(environment) {
  if (!new Set(["staging", "production"]).has(environment)) {
    throw new Error("Hosting artifacts must declare staging or production.");
  }
}

export function createHostingArtifact(environment, projectId) {
  assertEnvironment(environment);

  if (!projectId) {
    throw new Error("Hosting artifacts require a Firebase project ID.");
  }

  return {
    schemaVersion: 1,
    environment,
    projectId,
    viteMode: environment
  };
}

export function readHostingArtifact(artifactPath = resolve("dist", HOSTING_ARTIFACT_FILE)) {
  let artifact;

  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch (error) {
    throw new Error(`Hosting deployment requires a validated environment build artifact (${artifactPath}).`);
  }

  if (artifact?.schemaVersion !== 1) {
    throw new Error("Hosting artifact has an unsupported schema version.");
  }

  return artifact;
}

export function assertHostingArtifactMatchesDeployment(artifact, environment, projectId) {
  assertEnvironment(environment);

  if (!projectId) {
    throw new Error("Hosting deployment target project ID is required.");
  }

  if (environment === "staging" && projectId === PRODUCTION_PROJECT_ID) {
    throw new Error("Staging Hosting deployment cannot target the production project.");
  }

  if (environment === "production" && projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error("Production Hosting deployment must target inventory-app-19d04.");
  }

  if (artifact?.environment !== environment || artifact?.viteMode !== environment) {
    throw new Error(`Hosting artifact environment (${artifact?.environment || "unknown"}) does not match deployment environment (${environment}).`);
  }

  if (artifact?.projectId !== projectId) {
    throw new Error(`Hosting artifact project (${artifact?.projectId || "unknown"}) does not match deployment target (${projectId}).`);
  }
}
