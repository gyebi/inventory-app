const CONNECTION_BADGE_STATES = {
  offline: {
    label: "Offline",
    description: "Connection status: Offline. Your device is not connected to the internet."
  },
  connecting: {
    label: "Connecting",
    description: "Connection status: Connecting to the cloud."
  },
  reconnecting: {
    label: "Reconnecting",
    description: "Connection status: Reconnecting to the cloud."
  },
  attention: {
    label: "Needs attention",
    description: "Connection status: Needs attention. One or more cloud listeners could not sync."
  },
  live: {
    label: "Live",
    description: "Connection status: Live. All cloud listeners have confirmed server data."
  },
  synced: {
    label: "Synced",
    description: "Connection status: Synced. Waiting for server confirmation."
  }
};

export function getCloudConnectionBadgeState({
  online = true,
  isConnecting = false,
  isReconnecting = false,
  expectedListenerCount = 0,
  confirmedListenerCount = 0,
  failedListenerCount = 0
} = {}) {
  if (!online) return { id: "offline", ...CONNECTION_BADGE_STATES.offline };
  if (failedListenerCount > 0) return { id: "attention", ...CONNECTION_BADGE_STATES.attention };
  if (isConnecting) {
    return isReconnecting
      ? { id: "reconnecting", ...CONNECTION_BADGE_STATES.reconnecting }
      : { id: "connecting", ...CONNECTION_BADGE_STATES.connecting };
  }
  if (expectedListenerCount > 0 && confirmedListenerCount >= expectedListenerCount) {
    return { id: "live", ...CONNECTION_BADGE_STATES.live };
  }

  return { id: "synced", ...CONNECTION_BADGE_STATES.synced };
}
