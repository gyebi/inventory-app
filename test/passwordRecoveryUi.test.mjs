import assert from "node:assert/strict";
import test from "node:test";
import {
  createPasswordRecoveryRequestGate,
  wirePasswordRecoveryReturnAction
} from "../js/services/passwordRecoveryUi.js";

test("Return to sign in binds a real click handler instead of an inline global", () => {
  let clickHandler;
  let returns = 0;
  let prevented = 0;
  const button = {
    addEventListener(type, handler) {
      assert.equal(type, "click");
      clickHandler = handler;
    }
  };
  const root = {
    querySelector(selector) {
      assert.equal(selector, "[data-password-recovery-return]");
      return button;
    }
  };

  assert.equal(wirePasswordRecoveryReturnAction(root, () => {
    returns += 1;
  }), true);

  clickHandler({
    preventDefault() {
      prevented += 1;
    }
  });

  assert.equal(returns, 1);
  assert.equal(prevented, 1);
});

test("leaving password recovery invalidates a pending reset request", () => {
  const gate = createPasswordRecoveryRequestGate();
  const pendingRequest = gate.begin();

  assert.equal(gate.isCurrent(pendingRequest), true);
  gate.cancel();
  assert.equal(gate.isCurrent(pendingRequest), false);

  const nextRequest = gate.begin();
  assert.equal(gate.isCurrent(nextRequest), true);
});
