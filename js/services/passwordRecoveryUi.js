/**
 * Keep recovery-page event wiring and request lifetime separate from the
 * rendered markup. This avoids relying on module-scoped functions being
 * visible to inline browser event handlers.
 */
export function wirePasswordRecoveryReturnAction(root, onReturnToSignIn) {
  const returnAction = root.querySelector("[data-password-recovery-return]");

  if (!returnAction) {
    return false;
  }

  returnAction.addEventListener("click", (event) => {
    event.preventDefault();
    onReturnToSignIn();
  });

  return true;
}

export function createPasswordRecoveryRequestGate() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(requestGeneration) {
      return requestGeneration === generation;
    },
    cancel() {
      generation += 1;
    }
  };
}
