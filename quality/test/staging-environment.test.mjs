import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEnvironmentFile,
  validateFirebaseEnvironment
} from "../../scripts/validate-firebase-environment.mjs";

const stagingEnvironment = {
  VITE_FIREBASE_API_KEY: "staging-key",
  VITE_FIREBASE_AUTH_DOMAIN: "jyaano-staging.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "jyaano-staging",
  VITE_FIREBASE_STORAGE_BUCKET: "jyaano-staging.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
  VITE_FIREBASE_APP_ID: "1:123:web:staging",
  VITE_FIREBASE_FUNCTIONS_REGION: "us-central1"
};

test("staging configuration accepts a complete separate project", () => {
  assert.doesNotThrow(() => validateFirebaseEnvironment("staging", stagingEnvironment, "jyaano-staging"));
});

test("staging configuration rejects a production project fallback", () => {
  assert.throws(
    () => validateFirebaseEnvironment("staging", { ...stagingEnvironment, VITE_FIREBASE_PROJECT_ID: "inventory-app-19d04" }, "inventory-app-19d04"),
    /must not target/
  );
});

test("staging configuration requires every value in its own environment file", () => {
  const incomplete = { ...stagingEnvironment };
  delete incomplete.VITE_FIREBASE_APP_ID;
  assert.throws(() => validateFirebaseEnvironment("staging", incomplete, "jyaano-staging"), /Missing required/);
});

test("environment parser preserves explicit values without loading the local production file", () => {
  assert.deepEqual(
    parseEnvironmentFile("# synthetic\nVITE_FIREBASE_PROJECT_ID=jyaano-staging\nVITE_FIREBASE_API_KEY=test\n"),
    { VITE_FIREBASE_PROJECT_ID: "jyaano-staging", VITE_FIREBASE_API_KEY: "test" }
  );
});
