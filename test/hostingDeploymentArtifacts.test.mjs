import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertHostingArtifactMatchesDeployment,
  createHostingArtifact,
  PRODUCTION_PROJECT_ID
} from "../scripts/hosting-artifact.mjs";
import { validateDeploymentRequest } from "../scripts/deploy-firebase.mjs";

test("a staging Hosting artifact cannot be replaced by or deployed as a production artifact", () => {
  const stagingArtifact = createHostingArtifact("staging", "jyaano-staging");

  assert.doesNotThrow(() => {
    assertHostingArtifactMatchesDeployment(stagingArtifact, "staging", "jyaano-staging");
  });
  assert.throws(
    () => assertHostingArtifactMatchesDeployment(stagingArtifact, "production", PRODUCTION_PROJECT_ID),
    /does not match deployment environment/
  );
});

test("the Hosting predeploy check preserves a staging artifact and rejects a different environment", (t) => {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "jyaano-hosting-artifact-"));
  const artifactDirectory = resolve(temporaryDirectory, "dist");
  const artifactPath = resolve(artifactDirectory, ".jyaano-hosting-artifact.json");
  const verifierPath = resolve("scripts", "verify-hosting-artifact.mjs");
  const stagingArtifact = `${JSON.stringify(createHostingArtifact("staging", "jyaano-staging"))}\n`;

  t.after(() => rmSync(temporaryDirectory, { force: true, recursive: true }));
  mkdirSync(artifactDirectory);
  writeFileSync(artifactPath, stagingArtifact);

  const stagingResult = spawnSync(process.execPath, [verifierPath], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      JYAANO_HOSTING_DEPLOY_ENV: "staging",
      JYAANO_HOSTING_DEPLOY_PROJECT_ID: "jyaano-staging"
    }
  });
  const productionResult = spawnSync(process.execPath, [verifierPath], {
    cwd: temporaryDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      JYAANO_HOSTING_DEPLOY_ENV: "production",
      JYAANO_HOSTING_DEPLOY_PROJECT_ID: PRODUCTION_PROJECT_ID
    }
  });

  assert.equal(stagingResult.status, 0, stagingResult.stderr);
  assert.equal(readFileSync(artifactPath, "utf8"), stagingArtifact);
  assert.equal(productionResult.status, 1);
  assert.match(productionResult.stderr, /does not match deployment environment/);
});

test("Hosting deployment rejects environment and Firebase target mismatches", () => {
  const productionArtifact = createHostingArtifact("production", PRODUCTION_PROJECT_ID);

  assert.throws(
    () => assertHostingArtifactMatchesDeployment(productionArtifact, "staging", "jyaano-staging"),
    /does not match deployment environment/
  );
  assert.throws(
    () => assertHostingArtifactMatchesDeployment(createHostingArtifact("staging", "jyaano-staging"), "staging", "another-staging"),
    /does not match deployment target/
  );
  assert.throws(
    () => validateDeploymentRequest("staging", "hosting", {
      FIREBASE_STAGING_PROJECT_ID: PRODUCTION_PROJECT_ID
    }),
    /Refusing to deploy staging to the production Firebase project/
  );
  assert.throws(
    () => validateDeploymentRequest("production", "hosting", {}),
    /JYAANO_ALLOW_PRODUCTION_DEPLOY=yes/
  );
});

test("Firebase Hosting predeploy verifies the explicit artifact instead of rebuilding it", () => {
  const firebaseConfig = JSON.parse(readFileSync("firebase.json", "utf8"));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.deepEqual(firebaseConfig.hosting.predeploy, ["node scripts/verify-hosting-artifact.mjs"]);
  assert.doesNotMatch(firebaseConfig.hosting.predeploy.join(" "), /npm run build/);
  assert.match(packageJson.scripts["deploy:staging:hosting"], /npm run build:staging/);
  assert.match(packageJson.scripts["deploy:hosting"], /npm run build:production/);
});
