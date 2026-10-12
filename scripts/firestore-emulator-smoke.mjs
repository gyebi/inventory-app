import { initializeApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from "firebase/firestore";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required; do not run this smoke test against a live project.");
}

const [host, port] = emulatorHost.split(":");
const app = initializeApp({
  apiKey: "emulator-only-api-key",
  appId: "1:000000000000:web:emulator-smoke",
  authDomain: "localhost",
  projectId: "jyaano-emulator-smoke"
}, "firestore-emulator-smoke");
const db = getFirestore(app);

connectFirestoreEmulator(db, host, Number(port));

try {
  await getDoc(doc(db, "__smoke__", "connectivity"));
  throw new Error("Expected unauthenticated Firestore access to be rejected by rules.");
} catch (error) {
  if (error.code !== "permission-denied") {
    throw error;
  }
}

console.log("PASS: Firestore emulator connectivity and unauthenticated access boundary verified.");
