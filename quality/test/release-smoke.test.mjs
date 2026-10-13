import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const firebaseModule = readFileSync("js/firebase.js", "utf8");
const appModule = readFileSync("js/app.js", "utf8");
const deployScript = readFileSync("scripts/deploy-firebase.mjs", "utf8");
const printerInstaller = readFileSync("printer-bridge/deployment/install-linux.sh", "utf8");
const printerServiceTemplate = readFileSync("printer-bridge/deployment/inventory-printer.service", "utf8");

test("staging build protects against a production Firebase project", () => {
  assert.match(firebaseModule, /Staging builds must not use the production Firebase project/);
  assert.match(firebaseModule, /VITE_FIREBASE_FUNCTIONS_REGION/);
});

test("the inventory and sales pages remain part of the application entrypoint", () => {
  assert.match(appModule, /pages\/inventory\.js/);
  assert.match(appModule, /pages\/sales\.js/);
});

test("deployment guard explicitly blocks staging-to-production and unapproved production deploys", () => {
  assert.match(deployScript, /Refusing to deploy staging to the production Firebase project/);
  assert.match(deployScript, /JYAANO_ALLOW_PRODUCTION_DEPLOY=yes/);
});

test("printer bridge deployment retains an explicit origin option", () => {
  assert.match(printerInstaller, /--origin/);
  assert.match(printerServiceTemplate, /INVENTORY_ALLOWED_ORIGINS/);
});
