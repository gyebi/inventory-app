const test = require("node:test");
const assert = require("node:assert/strict");

process.env.INVENTORY_ALLOWED_ORIGINS = "https://inventory-app-19d04.web.app";
const bridge = require("../server");

test("allows only explicit and loopback browser origins", () => {
  assert.equal(bridge.isAllowedOrigin("https://inventory-app-19d04.web.app"), true);
  assert.equal(bridge.isAllowedOrigin("http://localhost:5173"), true);
  assert.equal(bridge.isAllowedOrigin("https://inventory-app-19d04.web.app.evil.test"), false);
  assert.equal(bridge.isAllowedOrigin("null"), false);
});

test("allows no-Origin diagnostics only from loopback", () => {
  assert.equal(bridge.isAuthorizedRequest({ socket: { remoteAddress: "127.0.0.1" } }, ""), true);
  assert.equal(bridge.isAuthorizedRequest({ socket: { remoteAddress: "::1" } }, ""), true);
  assert.equal(bridge.isAuthorizedRequest({ socket: { remoteAddress: "10.0.0.7" } }, ""), false);
});

test("CORS is exact-origin and includes Private Network Access support", () => {
  const headers = bridge.buildCorsHeaders("https://inventory-app-19d04.web.app");
  assert.equal(headers["Access-Control-Allow-Origin"], "https://inventory-app-19d04.web.app");
  assert.equal(headers["Access-Control-Allow-Private-Network"], "true");
  assert.equal(bridge.buildCorsHeaders("https://evil.test")["Access-Control-Allow-Origin"], undefined);
});
