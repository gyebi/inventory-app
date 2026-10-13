"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getAllowedOrigins } = require("../runtime-config");

test("local Functions emulator requires demo project and loopback origins", () => {
  assert.throws(
    () => getAllowedOrigins({
      JYAANO_DEPLOYMENT_ENV: "emulator",
      GCLOUD_PROJECT: "inventory-app-19d04",
      FUNCTIONS_ALLOWED_ORIGINS: "http://127.0.0.1:5173"
    }),
    /must use demo-jyaano/
  );
  assert.throws(
    () => getAllowedOrigins({
      JYAANO_DEPLOYMENT_ENV: "emulator",
      GCLOUD_PROJECT: "demo-jyaano",
      FUNCTIONS_ALLOWED_ORIGINS: "https://inventory-app-19d04.web.app"
    }),
    /loopback/
  );
  assert.deepEqual(
    getAllowedOrigins({
      JYAANO_DEPLOYMENT_ENV: "emulator",
      GCLOUD_PROJECT: "demo-jyaano",
      FUNCTIONS_ALLOWED_ORIGINS: "http://127.0.0.1:5173"
    }),
    ["http://127.0.0.1:5173"]
  );
});

test("staging Functions reject missing allowed origins", () => {
  assert.throws(() => getAllowedOrigins({ JYAANO_DEPLOYMENT_ENV: "staging" }), /require explicit/);
});

test("staging Functions reject production origins", () => {
  assert.throws(
    () => getAllowedOrigins({
      JYAANO_DEPLOYMENT_ENV: "staging",
      FUNCTIONS_ALLOWED_ORIGINS: "https://inventory-app-19d04.web.app"
    }),
    /must not allow production/
  );
});

test("staging Functions accept explicit staging origins", () => {
  assert.deepEqual(
    getAllowedOrigins({
      JYAANO_DEPLOYMENT_ENV: "staging",
      FUNCTIONS_ALLOWED_ORIGINS: "https://jyaano-staging.web.app,https://jyaano-staging.firebaseapp.com"
    }),
    ["https://jyaano-staging.web.app", "https://jyaano-staging.firebaseapp.com"]
  );
});
