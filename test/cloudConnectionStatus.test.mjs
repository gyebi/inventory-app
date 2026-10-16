import assert from "node:assert/strict";
import test from "node:test";
import { getCloudConnectionBadgeState } from "../js/utils/cloudConnectionStatus.js";

test("connection badge is Offline whenever the browser reports no network", () => {
  const state = getCloudConnectionBadgeState({
    online: false,
    isConnecting: false,
    expectedListenerCount: 7,
    confirmedListenerCount: 7
  });

  assert.equal(state.id, "offline");
  assert.equal(state.label, "Offline");
});

test("connection badge remains Connecting until listener data is available", () => {
  assert.equal(getCloudConnectionBadgeState({ online: true, isConnecting: true }).id, "connecting");
  assert.equal(getCloudConnectionBadgeState({ online: true, isConnecting: true, isReconnecting: true }).id, "reconnecting");
});

test("cached data is Synced rather than Live until every listener confirms the server", () => {
  assert.equal(getCloudConnectionBadgeState({
    online: true,
    expectedListenerCount: 7,
    confirmedListenerCount: 6
  }).id, "synced");

  assert.equal(getCloudConnectionBadgeState({
    online: true,
    expectedListenerCount: 7,
    confirmedListenerCount: 7
  }).id, "live");
});

test("a listener failure keeps the badge at Needs attention after another listener confirms", () => {
  const state = getCloudConnectionBadgeState({
    online: true,
    expectedListenerCount: 7,
    confirmedListenerCount: 7,
    failedListenerCount: 1
  });

  assert.equal(state.id, "attention");
  assert.equal(state.label, "Needs attention");
});
