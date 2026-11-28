import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const authSource = await readFile(new URL("../js/services/authService.js", import.meta.url), "utf8");
const recoverySource = await readFile(new URL("../js/services/passwordRecoveryCore.js", import.meta.url), "utf8");

function sourceFor(functionName) {
  const start = appSource.indexOf(`function ${functionName}`) >= 0
    ? appSource.indexOf(`function ${functionName}`)
    : appSource.indexOf(`async function ${functionName}`);
  const next = appSource.indexOf("\nfunction ", start + 1);
  const nextAsync = appSource.indexOf("\nasync function ", start + 1);
  const end = [next, nextAsync].filter((index) => index !== -1).sort((left, right) => left - right)[0];
  return appSource.slice(start, end === undefined ? undefined : end);
}

test("login exposes a password recovery form with return action and accessible email input", () => {
  assert.match(sourceFor("renderLogin"), /Forgot password\?/);
  const recovery = sourceFor("renderPasswordRecovery");
  assert.match(recovery, /id="recoveryEmail" type="email" autocomplete="email"/);
  assert.match(recovery, /Return to sign in/);
  assert.match(recovery, /data-password-recovery-return/);
  assert.match(recovery, /wirePasswordRecoveryReturnAction\(app, returnToSignIn\)/);
  assert.match(recoverySource, /If an account exists for this email/);
});

test("reset submission prevents repeat requests and does not read staff profiles", () => {
  const request = sourceFor("requestPasswordReset");
  assert.match(request, /if \(passwordResetProcessing\)/);
  assert.match(sourceFor("setPasswordResetProcessing"), /button\.disabled = isProcessing/);
  assert.match(request, /sendPasswordReset\(validation\.email\)/);
  assert.match(request, /passwordRecoveryRequestGate\.isCurrent\(requestGeneration\)/);
  assert.doesNotMatch(request, /getUserProfile|fetchUsersFromCloud|users/);
});

test("leaving recovery clears its transient request state", () => {
  assert.match(sourceFor("renderLogin"), /clearPasswordRecoveryState\(\)/);
  assert.match(sourceFor("clearPasswordRecoveryState"), /passwordRecoveryRequestGate\.cancel\(\)/);
  assert.match(sourceFor("clearPasswordRecoveryState"), /passwordResetProcessing = false/);
});

test("Firebase reset email uses the hosted action page and fixed configuration URL", () => {
  assert.match(authSource, /sendPasswordResetEmail\(auth, email, \{/);
  assert.match(authSource, /url: passwordResetContinueUrl/);
  assert.match(authSource, /handleCodeInApp: false/);
});

test("reauthentication uses a current-password field and exposes cancellation", () => {
  const reauthentication = sourceFor("renderPasswordReauthentication");
  assert.match(reauthentication, /id="currentPassword" type="password" autocomplete="current-password"/);
  assert.match(reauthentication, /Cancel/);
  assert.match(sourceFor("cancelPasswordReauthentication"), /passwordChangeFlow\.cancel\(\)/);
  assert.match(sourceFor("renderLogin"), /passwordChangeFlow\.cancel\(\)/);
});
