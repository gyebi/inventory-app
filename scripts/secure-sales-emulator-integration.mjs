import assert from "node:assert/strict";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { DEMO_EMULATOR_PROJECT_ID, LOCAL_EMULATOR_ENDPOINTS, SYNTHETIC_EMULATOR_FIREBASE_CONFIG, assertLocalEmulatorTarget } from "../js/utils/emulatorConfig.mjs";

assertLocalEmulatorTarget(process.env.GCLOUD_PROJECT, LOCAL_EMULATOR_ENDPOINTS);
const app = initializeApp(SYNTHETIC_EMULATOR_FIREBASE_CONFIG, "secure-sales-integration");
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

await signInWithEmailAndPassword(auth, "sales@demo.jyaano.test", "DemoPass!123");
const submit = httpsCallable(functions, "submitSecureSale");
const response = await submit({
  idempotencyKey: "emulator-secure-sale-0001",
  items: [{ productId: "demo-water", quantity: 1, unit: "base" }],
  paymentMethod: "cash"
});
assert.equal(response.data.committed, true);
assert.equal(response.data.items[0].batchAllocations[0].batchId, "demo-secure-batch-fefo");
const sale = await getDoc(doc(db, "sales", response.data.saleId));
assert.equal(sale.data().items[0].unitPrice, 6);
assert.equal(sale.data().items[0].lineTotalPesewas, 600);

await assert.rejects(
  () => setDoc(doc(db, "stockBatches", "client-write-denied"), { productId: "demo-water" }),
  (error) => error.code === "permission-denied"
);
await assert.rejects(
  () => setDoc(doc(db, "sales", "client-write-denied"), { totalAmount: 0 }),
  (error) => error.code === "permission-denied"
);
console.log(`PASS: secure callable, authoritative batch write, legacy-compatible receipt fields, and write-denial rules verified in ${DEMO_EMULATOR_PROJECT_ID}.`);
