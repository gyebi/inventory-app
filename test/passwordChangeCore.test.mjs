import assert from "node:assert/strict";
import test from "node:test";
import { createPasswordChangeFlow, validateNewPassword } from "../js/services/passwordChangeCore.js";

function authError(code) {
  return Object.assign(new Error(code), { code });
}

test("password change validates the required fields before calling Firebase", () => {
  assert.equal(validateNewPassword("", "").type, "validation-error");
  assert.match(validateNewPassword("short", "short").message, /at least 6/);
  assert.match(validateNewPassword("new-secret", "different").message, /do not match/);
});

test("normal password change updates the password then clears the required-change flag", async () => {
  const calls = [];
  const flow = createPasswordChangeFlow({
    updatePassword: async (password) => calls.push(["update", password]),
    reauthenticate: async () => calls.push(["reauthenticate"]),
    clearRequiredPasswordChange: async () => {
      calls.push(["clear-profile"]);
      return { uid: "staff-1", mustChangePassword: false };
    }
  });

  const result = await flow.start("new-secret", "new-secret");

  assert.equal(result.type, "complete");
  assert.deepEqual(result.profile, { uid: "staff-1", mustChangePassword: false });
  assert.deepEqual(calls, [["update", "new-secret"], ["clear-profile"]]);
});

test("recent-login requirement reauthenticates and retries the intended update exactly once", async () => {
  const updateAttempts = [];
  const reauthenticationAttempts = [];
  let firstAttempt = true;
  const flow = createPasswordChangeFlow({
    updatePassword: async (password) => {
      updateAttempts.push(password);
      if (firstAttempt) {
        firstAttempt = false;
        throw authError("auth/requires-recent-login");
      }
    },
    reauthenticate: async (password) => reauthenticationAttempts.push(password),
    clearRequiredPasswordChange: async () => ({ uid: "staff-1", mustChangePassword: false })
  });

  assert.equal((await flow.start("new-secret", "new-secret")).type, "reauthentication-required");
  assert.equal((await flow.reauthenticateAndRetry("current-secret")).type, "complete");
  assert.deepEqual(updateAttempts, ["new-secret", "new-secret"]);
  assert.deepEqual(reauthenticationAttempts, ["current-secret"]);
  assert.equal((await flow.reauthenticateAndRetry("current-secret")).type, "reauthentication-unavailable");
  assert.deepEqual(updateAttempts, ["new-secret", "new-secret"]);
});

test("incorrect current password remains a reauthentication error and cancellation clears the pending operation", async () => {
  let updateAttempts = 0;
  const flow = createPasswordChangeFlow({
    updatePassword: async () => {
      updateAttempts += 1;
      throw authError("auth/requires-recent-login");
    },
    reauthenticate: async () => {
      throw authError("auth/wrong-password");
    },
    clearRequiredPasswordChange: async () => ({})
  });

  await flow.start("new-secret", "new-secret");
  const failedReauth = await flow.reauthenticateAndRetry("bad-current-password");
  assert.equal(failedReauth.type, "reauthentication-failed");
  assert.equal(failedReauth.error.code, "auth/wrong-password");
  flow.cancel();
  assert.equal((await flow.reauthenticateAndRetry("current-secret")).type, "reauthentication-unavailable");
  assert.equal(updateAttempts, 1);
});

test("unsupported providers stop the pending password change without a retry loop", async () => {
  let updateAttempts = 0;
  const flow = createPasswordChangeFlow({
    updatePassword: async () => {
      updateAttempts += 1;
      throw authError("auth/requires-recent-login");
    },
    reauthenticate: async () => {
      throw authError("auth/unsupported-provider");
    },
    clearRequiredPasswordChange: async () => ({})
  });

  await flow.start("new-secret", "new-secret");
  assert.equal((await flow.reauthenticateAndRetry("current-secret")).type, "reauthentication-unsupported");
  assert.equal((await flow.reauthenticateAndRetry("current-secret")).type, "reauthentication-unavailable");
  assert.equal(updateAttempts, 1);
});

test("a profile-flag failure is partial success and retries only the profile update", async () => {
  let updateAttempts = 0;
  let profileAttempts = 0;
  const flow = createPasswordChangeFlow({
    updatePassword: async () => {
      updateAttempts += 1;
    },
    reauthenticate: async () => {},
    clearRequiredPasswordChange: async () => {
      profileAttempts += 1;
      if (profileAttempts === 1) {
        throw new Error("callable unavailable");
      }
      return { uid: "staff-1", mustChangePassword: false };
    }
  });

  assert.equal((await flow.start("new-secret", "new-secret")).type, "profile-clear-failed");
  assert.equal((await flow.retryProfileClear()).type, "complete");
  assert.equal(updateAttempts, 1);
  assert.equal(profileAttempts, 2);
});

test("password-flow source has no persistent-storage or logging path for password values", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../js/services/passwordChangeCore.js", import.meta.url), "utf8")
  );

  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(log|error|warn)/);
});
