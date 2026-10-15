import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseEnvironmentFile,
  validateFirebaseEnvironment
} from "./validate-firebase-environment.mjs";
import { createHostingArtifact, HOSTING_ARTIFACT_FILE } from "./hosting-artifact.mjs";
import { publishWebSerialTestPage } from "./staging-web-serial-test-page.mjs";

const [environment] = process.argv.slice(2);

if (!new Set(["staging", "production"]).has(environment)) {
  throw new Error("Usage: node scripts/build-hosting.mjs <staging|production>");
}

const environmentFile = `.env.${environment}`;
const environmentConfig = parseEnvironmentFile(readFileSync(environmentFile, "utf8"));
validateFirebaseEnvironment(
  environment,
  environmentConfig,
  process.env.FIREBASE_STAGING_PROJECT_ID || ""
);

const viteExecutable = process.platform === "win32"
  ? resolve("node_modules", ".bin", "vite.cmd")
  : resolve("node_modules", ".bin", "vite");

execFileSync(viteExecutable, ["build", "--mode", environment], { stdio: "inherit" });

const artifact = createHostingArtifact(environment, environmentConfig.VITE_FIREBASE_PROJECT_ID.trim());
const outputDirectory = resolve("dist");
mkdirSync(outputDirectory, { recursive: true });
publishWebSerialTestPage(environment, outputDirectory);
writeFileSync(resolve(outputDirectory, HOSTING_ARTIFACT_FILE), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`PASS: ${environment} Hosting artifact is ready for ${artifact.projectId}.`);
