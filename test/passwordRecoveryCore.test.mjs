import assert from "node:assert/strict";
import test from "node:test";
import { getPasswordResetContinueUrl } from "../js/utils/passwordResetUrl.mjs";
import {
  getPasswordResetResult,
  PASSWORD_RESET_SUCCESS_MESSAGE,
  validatePasswordResetEmail
} from "../js/services/passwordRecoveryCore.js";

test("password reset validates malformed emails without requesting account data", () => {
  assert.deepEqual(validatePasswordResetEmail(""), {
    valid: false,
    email: "",
    message: "Enter your staff email address."
  });
  assert.deepEqual(validatePasswordResetEmail("not-an-email"), {
    valid: false,
    email: "not-an-email",
    message: "Enter a valid staff email address."
  });
  assert.deepEqual(validatePasswordResetEmail(" Staff@Example.com "), {
    valid: true,
    email: "staff@example.com",
    message: ""
  });
});

test("password reset keeps account existence messaging neutral", () => {
  assert.deepEqual(getPasswordResetResult(), {
    type: "success",
    message: PASSWORD_RESET_SUCCESS_MESSAGE
  });
  assert.deepEqual(getPasswordResetResult({ code: "auth/user-not-found" }), {
    type: "success",
    message: PASSWORD_RESET_SUCCESS_MESSAGE
  });
});

test("password reset provides non-enumerating throttle and network errors", () => {
  assert.match(getPasswordResetResult({ code: "auth/too-many-requests" }).message, /Too many reset requests/);
  assert.match(getPasswordResetResult({ code: "auth/network-request-failed" }).message, /Check your connection/);
  assert.equal(getPasswordResetResult({ code: "auth/internal-error" }).type, "error");
  assert.doesNotMatch(getPasswordResetResult({ code: "auth/internal-error" }).message, /account|email/i);
});

test("password reset continue URL is fixed by the validated environment", () => {
  assert.equal(getPasswordResetContinueUrl({
    mode: "production",
    projectId: "inventory-app-19d04"
  }), "https://inventory-app-19d04.web.app/");
  assert.equal(getPasswordResetContinueUrl({
    mode: "staging",
    projectId: "jyaano-staging"
  }), "https://jyaano-staging.web.app/");
  assert.equal(getPasswordResetContinueUrl({
    mode: "emulator",
    projectId: "demo-jyaano"
  }), "http://127.0.0.1:5173/");
});

test("password reset continue URL rejects invalid environment project IDs", () => {
  assert.throws(() => getPasswordResetContinueUrl({
    mode: "production",
    projectId: "not a valid project id"
  }), /valid Firebase project ID/);
  assert.throws(() => getPasswordResetContinueUrl({ mode: "staging", projectId: "" }), /valid Firebase project ID/);
});
