import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEMO_EMULATOR_PROJECT_ID,
  LOCAL_EMULATOR_ENDPOINTS,
  SYNTHETIC_EMULATOR_FIREBASE_CONFIG,
  assertLocalEmulatorTarget
} from "../js/utils/emulatorConfig.mjs";

test("local emulator target accepts only the synthetic demo project and loopback endpoints", () => {
  assert.doesNotThrow(() => {
    assertLocalEmulatorTarget(DEMO_EMULATOR_PROJECT_ID, LOCAL_EMULATOR_ENDPOINTS);
  });
  assert.equal(SYNTHETIC_EMULATOR_FIREBASE_CONFIG.projectId, DEMO_EMULATOR_PROJECT_ID);

  assert.throws(
    () => assertLocalEmulatorTarget("inventory-app-19d04", LOCAL_EMULATOR_ENDPOINTS),
    /must use Firebase project demo-jyaano/
  );
  assert.throws(
    () => assertLocalEmulatorTarget(DEMO_EMULATOR_PROJECT_ID, {
      ...LOCAL_EMULATOR_ENDPOINTS,
      auth: { host: "firebase.google.com", port: 9099 }
    }),
    /loopback host/
  );
  assert.throws(
    () => assertLocalEmulatorTarget(DEMO_EMULATOR_PROJECT_ID, {
      ...LOCAL_EMULATOR_ENDPOINTS,
      functions: { host: "127.0.0.1", port: 443 }
    }),
    /port 5001/
  );
});

test("emulator Vite mode uses synthetic config and connects every Firebase SDK before use", () => {
  const firebaseModule = readFileSync("js/firebase.js", "utf8");

  assert.match(firebaseModule, /import\.meta\.env\.MODE === "emulator"/);
  assert.match(firebaseModule, /SYNTHETIC_EMULATOR_FIREBASE_CONFIG/);
  assert.match(firebaseModule, /connectAuthEmulator/);
  assert.match(firebaseModule, /connectFirestoreEmulator/);
  assert.match(firebaseModule, /connectFunctionsEmulator/);
});

test("deployment and local commands keep emulator execution isolated", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const deployment = spawnSync(process.execPath, ["scripts/deploy-firebase.mjs", "emulator", "hosting"], {
    encoding: "utf8"
  });

  assert.match(packageJson.scripts["dev:emulator"], /vite --mode emulator/);
  assert.match(packageJson.scripts["emulators:start"], /--project demo-jyaano/);
  assert.match(packageJson.scripts["emulators:seed"], /FIREBASE_AUTH_EMULATOR_HOST=127\.0\.0\.1:9099/);
  assert.equal(deployment.status, 1);
  assert.match(deployment.stderr, /Emulator mode cannot be deployed/);
});
