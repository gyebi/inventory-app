import {
  DEMO_EMULATOR_PROJECT_ID,
  LOCAL_EMULATOR_ENDPOINTS,
  SYNTHETIC_EMULATOR_FIREBASE_CONFIG,
  assertLocalEmulatorTarget
} from "../js/utils/emulatorConfig.mjs";

assertLocalEmulatorTarget(SYNTHETIC_EMULATOR_FIREBASE_CONFIG.projectId, LOCAL_EMULATOR_ENDPOINTS);

if (SYNTHETIC_EMULATOR_FIREBASE_CONFIG.projectId !== DEMO_EMULATOR_PROJECT_ID) {
  throw new Error("Local emulator configuration must not use a hosted Firebase project.");
}

console.log(`PASS: local Firebase emulator mode is isolated to ${DEMO_EMULATOR_PROJECT_ID}.`);
