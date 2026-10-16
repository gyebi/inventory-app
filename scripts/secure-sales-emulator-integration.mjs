import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc, terminate } from "firebase/firestore";
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

await signInWithEmailAndPassword(auth, "storekeeper@demo.jyaano.test", "DemoPass!123");
const submit = httpsCallable(functions, "submitSecureSale");
const quote = httpsCallable(functions, "quoteSecureSale");
const receive = httpsCallable(functions, "receiveSecureStock");
const receiveKey = `emulator-secure-receive-${Date.now()}`;
const receivePayload = {
  idempotencyKey: receiveKey,
  purchase: {
    supplier: "Synthetic Secure Supplier", invoiceNumber: `SYN-${Date.now()}`, purchaseDate: "2026-10-16T09:00", paymentStatus: "Credit", dueDate: "2026-11-01", notes: "Synthetic emulator receipt", receivedByNote: "Storekeeper",
    lines: [{ productId: "demo-water", quantity: 2, unit: "bulk", totalBulkCostPesewas: 9601, additionalExpensesPesewas: 199, expiryBusinessDate: "2026-10-16" }]
  }
};
const received = await receive(receivePayload);
const receiveRetry = await receive(receivePayload);
assert.deepEqual(receiveRetry.data, received.data, "a receive retry must return the original purchase rather than add stock twice");
assert.equal(received.data.lines[0].baseQuantity, 24);
assert.equal(received.data.lines[0].totalLandedCostPesewas, 9800);
const receivedBatch = await getDoc(doc(db, "stockBatches", received.data.lines[0].batchId));
assert.equal(receivedBatch.data().remainingBaseQuantity, 24);
const receivedReceipt = await getDoc(doc(db, "stockReceipts", received.data.lines[0].receiptId));
assert.equal(receivedReceipt.data().paymentStatus, "Credit");

await signOut(auth);
await signInWithEmailAndPassword(auth, "sales@demo.jyaano.test", "DemoPass!123");
const waterProduct = await getDoc(doc(db, "products", "demo-water"));
const bulkUnitLabel = waterProduct.data().bulkUnit;
const quoteResponse = await quote({
  items: [{ productId: "demo-water", quantity: 1, unit: "base" }],
  paymentMethod: "cash"
});
assert.equal(quoteResponse.data.committed, false);
assert.equal(
  quoteResponse.data.totalAmountPesewas,
  quoteResponse.data.subtotalPesewas + quoteResponse.data.taxBreakdown.taxAmountPesewas
);
const saleKey = `emulator-secure-sale-${Date.now()}`;
const response = await submit({
  idempotencyKey: saleKey,
  items: [{ productId: "demo-water", quantity: 1, unit: "base" }],
  paymentMethod: "cash",
  expectedQuoteFingerprint: quoteResponse.data.quoteFingerprint
});
assert.equal(response.data.committed, true);
assert.equal(response.data.sale.id, response.data.saleId);
assert.equal(response.data.items[0].batchAllocations[0].batchId, received.data.lines[0].batchId);
const retry = await submit({
  idempotencyKey: saleKey,
  items: [{ productId: "demo-water", quantity: 1, unit: "base" }],
  paymentMethod: "cash",
  expectedQuoteFingerprint: quoteResponse.data.quoteFingerprint
});
assert.deepEqual(retry.data, response.data, "a retry must return the original sale rather than create another one");
const sale = await getDoc(doc(db, "sales", response.data.saleId));
assert.equal(sale.data().items[0].unitPrice, response.data.items[0].unitPrice);
assert.equal(sale.data().items[0].lineTotalPesewas, response.data.items[0].lineTotalPesewas);

const bulkQuote = await quote({
  items: [{ productId: "demo-water", quantity: 1, unit: "bulk" }],
  paymentMethod: "cash"
});
const bulkResponse = await submit({
  idempotencyKey: `emulator-secure-sale-bulk-${Date.now()}`,
  items: [{ productId: "demo-water", quantity: 1, unit: "bulk" }],
  paymentMethod: "cash",
  expectedQuoteFingerprint: bulkQuote.data.quoteFingerprint
});
assert.equal(bulkResponse.data.items[0].unitLabel, bulkUnitLabel);
assert.notEqual(bulkResponse.data.items[0].unitLabel, "bulk");
assert.equal(bulkResponse.data.totalAmountPesewas, bulkQuote.data.totalAmountPesewas);
assert.equal(
  bulkResponse.data.totalAmountPesewas,
  bulkResponse.data.subtotalPesewas + bulkResponse.data.taxBreakdown.taxAmountPesewas
);
const bulkSale = await getDoc(doc(db, "sales", bulkResponse.data.saleId));
assert.equal(bulkSale.data().items[0].unitLabel, bulkUnitLabel);
assert.equal(bulkSale.data().totalAmountPesewas, bulkQuote.data.totalAmountPesewas);

const postReceiveQuote = await quote({ items: [{ productId: "demo-water", quantity: 1, unit: "base" }], paymentMethod: "cash" });
const postReceiveSale = await submit({ idempotencyKey: `emulator-sale-after-receive-${Date.now()}`, items: [{ productId: "demo-water", quantity: 1, unit: "base" }], paymentMethod: "cash", expectedQuoteFingerprint: postReceiveQuote.data.quoteFingerprint });
assert.equal(postReceiveSale.data.committed, true);
const consumedReceivedBatch = await getDoc(doc(db, "stockBatches", received.data.lines[0].batchId));
assert.equal(consumedReceivedBatch.data().remainingBaseQuantity, 10, "a sale must consume stock from the newly received authoritative batch");

await assert.rejects(
  () => setDoc(doc(db, "stockBatches", "client-write-denied"), { productId: "demo-water" }),
  (error) => error.code === "permission-denied"
);
await assert.rejects(
  () => setDoc(doc(db, "sales", "client-write-denied"), { totalAmount: 0 }),
  (error) => error.code === "permission-denied"
);
await assert.rejects(
  () => setDoc(doc(db, "stockReceipts", "legacy-receiving-denied"), { productId: "demo-water", quantityReceived: 1 }),
  (error) => error.code === "permission-denied"
);
await terminate(db);
await deleteApp(app);
console.log(`PASS: secure callable, idempotent returned sale, authoritative batch write, legacy-compatible receipt fields, and write-denial rules verified in ${DEMO_EMULATOR_PROJECT_ID}.`);
