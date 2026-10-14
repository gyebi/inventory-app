import { initializeApp } from "firebase/app";
import { connectAuthEmulator, signInWithEmailAndPassword, signOut, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import {
  DEMO_EMULATOR_PROJECT_ID,
  LOCAL_EMULATOR_ENDPOINTS,
  SYNTHETIC_EMULATOR_FIREBASE_CONFIG,
  assertLocalEmulatorTarget
} from "../js/utils/emulatorConfig.mjs";

function parseHostPort(value, service) {
  const [host, port] = String(value || "").trim().split(":");

  if (!host || !port || !/^\d+$/.test(port)) {
    throw new Error(`${service} emulator host must be in host:port form.`);
  }

  return { host, port: Number(port) };
}

function parseFunctionsEndpoint(value) {
  const url = new URL(String(value || ""));
  return { host: url.hostname, port: Number(url.port || 80) };
}

const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
const endpoints = {
  auth: parseHostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth"),
  firestore: parseHostPort(process.env.FIRESTORE_EMULATOR_HOST, "Firestore"),
  functions: parseFunctionsEndpoint(process.env.FUNCTIONS_EMULATOR_URL)
};

assertLocalEmulatorTarget(projectId, endpoints);

if (SYNTHETIC_EMULATOR_FIREBASE_CONFIG.projectId !== DEMO_EMULATOR_PROJECT_ID) {
  throw new Error("Smoke checks must not use a hosted Firebase configuration.");
}

const app = initializeApp(SYNTHETIC_EMULATOR_FIREBASE_CONFIG, "local-emulator-smoke");
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");

connectAuthEmulator(auth, `http://${endpoints.auth.host}:${endpoints.auth.port}`, { disableWarnings: true });
connectFirestoreEmulator(db, endpoints.firestore.host, endpoints.firestore.port);
connectFunctionsEmulator(functions, endpoints.functions.host, endpoints.functions.port);

const credential = await signInWithEmailAndPassword(auth, "sales@demo.jyaano.test", "DemoPass!123");

if (credential.user.uid !== "demo-sales") {
  throw new Error("Auth emulator returned an unexpected synthetic account.");
}

const profile = await getDoc(doc(db, "users", credential.user.uid));

if (!profile.exists() || profile.data().role !== "sales") {
  throw new Error("Firestore emulator did not return the seeded sales profile.");
}

const ensureProfile = httpsCallable(functions, "ensureSignedInUserProfile");
await ensureProfile({});
await signOut(auth);

console.log("PASS: Auth, Firestore, and Functions local emulators are isolated and usable.");
