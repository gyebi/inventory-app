import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import {
  LOCAL_EMULATOR_ENDPOINTS,
  SYNTHETIC_EMULATOR_FIREBASE_CONFIG,
  assertLocalEmulatorTarget
} from "./utils/emulatorConfig.mjs";

const PRODUCTION_PROJECT_ID = "inventory-app-19d04";
const isStagingBuild = import.meta.env.MODE === "staging";
const isLocalEmulatorBuild = import.meta.env.MODE === "emulator";
const firebaseConfig = isLocalEmulatorBuild
  ? SYNTHETIC_EMULATOR_FIREBASE_CONFIG
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    };
const functionsRegion = isLocalEmulatorBuild
  ? "us-central1"
  : (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1");

const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (!isLocalEmulatorBuild && missingConfig.length > 0) {
  throw new Error(`Missing Firebase configuration: ${missingConfig.join(", ")}`);
}

if (isStagingBuild && firebaseConfig.projectId === PRODUCTION_PROJECT_ID) {
  throw new Error("Staging builds must not use the production Firebase project.");
}

if (isLocalEmulatorBuild) {
  assertLocalEmulatorTarget(firebaseConfig.projectId, LOCAL_EMULATOR_ENDPOINTS);
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, functionsRegion);

if (isLocalEmulatorBuild) {
  connectAuthEmulator(auth, `http://${LOCAL_EMULATOR_ENDPOINTS.auth.host}:${LOCAL_EMULATOR_ENDPOINTS.auth.port}`, {
    disableWarnings: true
  });
  connectFirestoreEmulator(db, LOCAL_EMULATOR_ENDPOINTS.firestore.host, LOCAL_EMULATOR_ENDPOINTS.firestore.port);
  connectFunctionsEmulator(functions, LOCAL_EMULATOR_ENDPOINTS.functions.host, LOCAL_EMULATOR_ENDPOINTS.functions.port);
}
