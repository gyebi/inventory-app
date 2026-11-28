function result(type, extra = {}) {
  return { type, ...extra };
}

function errorCode(error) {
  return error?.code || "";
}

export function validateNewPassword(newPassword, confirmation) {
  if (!newPassword || !confirmation) {
    return result("validation-error", { message: "Enter and confirm your new password." });
  }

  if (newPassword.length < 6) {
    return result("validation-error", { message: "New password must be at least 6 characters." });
  }

  if (newPassword !== confirmation) {
    return result("validation-error", { message: "The new password and confirmation do not match." });
  }

  return result("valid");
}

/**
 * Holds a pending new password only in this closure while Firebase asks for a
 * recent email/password credential. No values are returned, logged, or stored.
 */
export function createPasswordChangeFlow({ updatePassword, reauthenticate, clearRequiredPasswordChange }) {
  let pendingNewPassword = "";
  let retryUsed = false;
  let profileClearPending = false;

  function clearSensitiveState() {
    pendingNewPassword = "";
    retryUsed = false;
  }

  async function clearProfileFlag() {
    try {
      const profile = await clearRequiredPasswordChange();
      profileClearPending = false;
      return result("complete", { profile });
    } catch (error) {
      // The password has already changed. Keep only a non-sensitive recovery
      // state so retrying this step never repeats the password update.
      profileClearPending = true;
      return result("profile-clear-failed", { error });
    }
  }

  async function updatePendingPassword({ afterReauthentication = false } = {}) {
    try {
      await updatePassword(pendingNewPassword);
      clearSensitiveState();
      return clearProfileFlag();
    } catch (error) {
      if (errorCode(error) === "auth/requires-recent-login" && !afterReauthentication) {
        return result("reauthentication-required");
      }

      clearSensitiveState();
      return result("password-update-failed", { error });
    }
  }

  return {
    async start(newPassword, confirmation) {
      const validation = validateNewPassword(newPassword, confirmation);

      if (validation.type !== "valid") {
        return validation;
      }

      pendingNewPassword = newPassword;
      retryUsed = false;
      profileClearPending = false;
      return updatePendingPassword();
    },

    async reauthenticateAndRetry(currentPassword) {
      if (!pendingNewPassword || retryUsed) {
        clearSensitiveState();
        return result("reauthentication-unavailable");
      }

      try {
        // Deliberately do not retain the current password after this call.
        await reauthenticate(currentPassword);
      } catch (error) {
        if (errorCode(error) === "auth/unsupported-provider") {
          clearSensitiveState();
          return result("reauthentication-unsupported", { error });
        }

        return result("reauthentication-failed", { error });
      }

      retryUsed = true;
      return updatePendingPassword({ afterReauthentication: true });
    },

    async retryProfileClear() {
      if (!profileClearPending) {
        return result("profile-clear-unavailable");
      }

      return clearProfileFlag();
    },

    cancel() {
      clearSensitiveState();
      profileClearPending = false;
    }
  };
}
