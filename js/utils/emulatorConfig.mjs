export const DEMO_EMULATOR_PROJECT_ID = "demo-jyaano";

export const LOCAL_EMULATOR_ENDPOINTS = Object.freeze({
  auth: Object.freeze({ host: "127.0.0.1", port: 9099 }),
  firestore: Object.freeze({ host: "127.0.0.1", port: 8080 }),
  functions: Object.freeze({ host: "127.0.0.1", port: 5001 })
});

export const SYNTHETIC_EMULATOR_FIREBASE_CONFIG = Object.freeze({
  apiKey: "emulator-only-api-key",
  authDomain: "127.0.0.1",
  projectId: DEMO_EMULATOR_PROJECT_ID,
  storageBucket: "demo-jyaano.localhost",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demo-jyaano"
});

export function isLoopbackHost(host) {
  const normalized = String(host || "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();

  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

export function assertLocalEmulatorTarget(projectId, endpoints = LOCAL_EMULATOR_ENDPOINTS) {
  if (projectId !== DEMO_EMULATOR_PROJECT_ID) {
    throw new Error(`Local emulator mode must use Firebase project ${DEMO_EMULATOR_PROJECT_ID}.`);
  }

  for (const [service, expected] of Object.entries(LOCAL_EMULATOR_ENDPOINTS)) {
    const endpoint = endpoints?.[service];

    if (!endpoint || !isLoopbackHost(endpoint.host)) {
      throw new Error(`Local ${service} emulator endpoint must use a loopback host.`);
    }

    if (Number(endpoint.port) !== expected.port) {
      throw new Error(`Local ${service} emulator endpoint must use port ${expected.port}.`);
    }
  }
}
