import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { connectAuthEmulator, confirmPasswordReset, getAuth as getClientAuth, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { initializeApp as initializeClientApp } from "firebase/app";
import { SYNTHETIC_EMULATOR_FIREBASE_CONFIG } from "../../js/utils/emulatorConfig.mjs";
import { getPasswordResetContinueUrl } from "../../js/utils/passwordResetUrl.mjs";
import { getPasswordResetResult, PASSWORD_RESET_SUCCESS_MESSAGE } from "../../js/services/passwordRecoveryCore.js";

const PROJECT_ID = "demo-jyaano";
const AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

function requireExactEnvironment() {
  if (process.env.GCLOUD_PROJECT !== PROJECT_ID || process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_EMULATOR_HOST) {
    throw new Error("This integration may run only against demo-jyaano at the local Auth and Firestore emulator endpoints.");
  }
}

async function requireReachable(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null);

  if (!response) {
    throw new Error(`Required local emulator is not reachable: ${url}`);
  }
}

async function getResetCode(email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`http://${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
    const payload = await response.json();
    const match = payload.oobCodes?.find((entry) => entry.email === email && entry.requestType === "PASSWORD_RESET");

    if (match?.oobCode) {
      return match.oobCode;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Auth emulator did not expose a generated password-reset code for the synthetic user.");
}

async function resetOutcome(auth, email, continueUrl) {
  try {
    await sendPasswordResetEmail(auth, email, { url: continueUrl, handleCodeInApp: false });
    return getPasswordResetResult();
  } catch (error) {
    return getPasswordResetResult(error);
  }
}

requireExactEnvironment();
await requireReachable(`http://${AUTH_EMULATOR_HOST}`);
await requireReachable(`http://${FIRESTORE_EMULATOR_HOST}`);

const runId = randomUUID().replaceAll("-", "").slice(0, 16);
const uid = `password-recovery-${runId}`;
const email = `password-recovery-${runId}@demo.jyaano.test`;
const unknownEmail = `password-recovery-unknown-${runId}@demo.jyaano.test`;
const oldPassword = `Old-${runId}-Pass!`;
const newPassword = `New-${runId}-Pass!`;
const continueUrl = getPasswordResetContinueUrl({ mode: "emulator", projectId: PROJECT_ID });
const adminApp = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
const adminAuth = getAuth(adminApp);
const db = getFirestore(adminApp);
const clientApp = initializeClientApp(SYNTHETIC_EMULATOR_FIREBASE_CONFIG, `password-recovery-integration-${runId}`);
const auth = getClientAuth(clientApp);

connectAuthEmulator(auth, `http://${AUTH_EMULATOR_HOST}`, { disableWarnings: true });

try {
  await adminAuth.createUser({ uid, email, password: oldPassword, disabled: false });
  await db.collection("users").doc(uid).set({
    uid,
    email,
    fullName: "Password Recovery Integration",
    displayName: "Password Recovery Integration",
    username: `password.recovery.${runId}`,
    role: "sales",
    active: true,
    isActive: true,
    mustChangePassword: true,
    credentialSetupMode: "temporary_password"
  });

  const known = await resetOutcome(auth, email, continueUrl);
  const unknown = await resetOutcome(auth, unknownEmail, continueUrl);
  assert.deepEqual(known, unknown, "known and unknown reset requests must expose identical UI outcomes");
  assert.deepEqual(known, { type: "success", message: PASSWORD_RESET_SUCCESS_MESSAGE });

  const resetCode = await getResetCode(email);
  await confirmPasswordReset(auth, resetCode, newPassword);

  await assert.rejects(
    () => signInWithEmailAndPassword(auth, email, oldPassword),
    (error) => ["auth/invalid-credential", "auth/wrong-password"].includes(error?.code)
  );

  const credential = await signInWithEmailAndPassword(auth, email, newPassword);
  assert.equal(credential.user.uid, uid);
  await signOut(auth);

  const profile = await db.collection("users").doc(uid).get();
  assert.equal(profile.data()?.mustChangePassword, true, "email reset must not clear the mandatory-change flag");

  console.log(`PASS: password recovery Auth integration completed for synthetic user ${email}.`);
  console.log(`PASS: continue URL remained local: ${continueUrl}`);
} finally {
  await Promise.allSettled([
    db.collection("users").doc(uid).delete(),
    adminAuth.deleteUser(uid)
  ]);
}
