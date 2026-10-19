import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, runTransaction, setDoc, updateDoc, terminate } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { DEMO_EMULATOR_PROJECT_ID, LOCAL_EMULATOR_ENDPOINTS, SYNTHETIC_EMULATOR_FIREBASE_CONFIG, assertLocalEmulatorTarget } from "../js/utils/emulatorConfig.mjs";

const PASSWORD = "DemoPass!123";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const endpoints = LOCAL_EMULATOR_ENDPOINTS;
const apps = [];

function hostPort(value, label) { const [host, port] = String(value || "").split(":"); if (!host || !/^\d+$/.test(port || "")) throw new Error(`${label} must be host:port.`); return { host, port: Number(port) }; }
function functionEndpoint(value) { const url = new URL(String(value || "")); return { host: url.hostname, port: Number(url.port || 80) }; }
assertLocalEmulatorTarget(String(process.env.GCLOUD_PROJECT || ""), { auth: hostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth"), firestore: hostPort(process.env.FIRESTORE_EMULATOR_HOST, "Firestore"), functions: functionEndpoint(process.env.FUNCTIONS_EMULATOR_URL) });
for (const endpoint of Object.values(endpoints)) await fetch(`http://${endpoint.host}:${endpoint.port}`, { signal: AbortSignal.timeout(3000) });

const failCode = (expected) => (error) => String(error?.code || "").endsWith(expected);
async function client(name, email) {
  const app = initializeApp(SYNTHETIC_EMULATOR_FIREBASE_CONFIG, `${name}-${suffix}`);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await signInWithEmailAndPassword(auth, email, PASSWORD);
  const result = { app, auth, db, call: (name) => httpsCallable(functions, name) }; apps.push(result); return result;
}
async function close() { await Promise.all(apps.map(async ({ app, auth, db }) => { await signOut(auth).catch(() => undefined); await terminate(db).catch(() => undefined); await deleteApp(app).catch(() => undefined); })); }
function product(name, category, quantity) { return { name, category, active: true, isActive: true, baseUnit: "Bottle", bulkUnit: "Carton", unitsPerBulk: 12, quantity, costPrice: 2, sellingPrice: 4, lowStockThreshold: 1, updatedAt: new Date().toISOString(), syntheticStocktakingFixture: true }; }
async function fixture(admin, keeper, id, name, category, quantity, version = 1) { await setDoc(doc(admin.db, "products", id), { ...product(name, category, quantity), ...(version === 2 ? { inventorySchemaVersion: 2 } : {}) }); if (version !== 2) await setDoc(doc(keeper.db, "stockReceipts", `receipt-${id}`), { productId: id, batchId: `batch-${id}`, quantityReceived: quantity, receivedAt: new Date().toISOString(), expiryDate: "2099-12-31", syntheticStocktakingFixture: true }); }

const admin = await client("simple-stocktake-admin", "admin@demo.jyaano.test");
const manager = await client("simple-stocktake-manager", "manager@demo.jyaano.test");
const keeperA = await client("simple-stocktake-keeper-a", "storekeeper@demo.jyaano.test");
const keeperB = await client("simple-stocktake-keeper-b", "storekeeper@demo.jyaano.test");
const sales = await client("simple-stocktake-sales", "sales@demo.jyaano.test");
const category = `Simple stocktake ${suffix}`;
const ids = { water: `simple-water-${suffix}`, moving: `simple-moving-${suffix}`, conversion: `simple-conversion-${suffix}`, v2: `simple-v2-${suffix}`, unrelated: `simple-unrelated-${suffix}`, zero: `simple-zero-product-${suffix}` };
let originalSecure = null;

try {
  const secureRef = doc(admin.db, "settings", "secureSales"); const secureSnapshot = await getDoc(secureRef); originalSecure = secureSnapshot.exists() ? secureSnapshot.data() : null;
  await setDoc(secureRef, { enabled: false, syntheticStocktakingIntegration: suffix }, { merge: true });
  const staffClients = { admin, manager, storekeeper: keeperA, sales };
  const staffRoles = await Promise.all(Object.entries(staffClients).map(async ([id, participant]) => ({
    id,
    role: (await getDoc(doc(participant.db, "users", participant.auth.currentUser.uid))).data()?.role,
  })));
  assert.deepEqual(staffRoles, [{ id: "admin", role: "admin" }, { id: "manager", role: "manager" }, { id: "storekeeper", role: "storekeeper" }, { id: "sales", role: "sales" }]);
  // This mirrors Add Product's legacy, zero-stock record: no receipt is
  // manufactured, and secure mode was explicitly confirmed disabled above.
  await setDoc(doc(admin.db, "products", ids.zero), { ...product("Zero-stock legacy product", `Navigation ${suffix}`, 0), syntheticNavigationFixture: true });
  const zeroProduct = await getDoc(doc(keeperB.db, "products", ids.zero));
  assert.equal(zeroProduct.data()?.quantity, 0);
  assert.notEqual(Number(zeroProduct.data()?.inventorySchemaVersion), 2);
  await fixture(admin, keeperA, ids.water, "Simple Water", category, 10);
  await fixture(admin, keeperA, ids.moving, "Moving Water", `${category} moving`, 5);
  await fixture(admin, keeperA, ids.conversion, "Conversion Water", `${category} conversion`, 6);
  await fixture(admin, keeperA, ids.v2, "Unsupported Secure Water", `${category} v2`, 1, 2);
  await fixture(admin, keeperA, ids.unrelated, "Unrelated Water", `${category} unrelated`, 4);

  // Existing legacy direct sale/receiving transaction shape remains usable.
  await runTransaction(sales.db, async (transaction) => { const snapshot = await transaction.get(doc(sales.db, "products", ids.unrelated)); transaction.update(snapshot.ref, { quantity: Number(snapshot.data().quantity) - 1, updatedAt: new Date().toISOString() }); transaction.set(doc(sales.db, "sales", `legacy-sale-${suffix}`), { productId: ids.unrelated, items: [], totalAmount: 4, createdAt: new Date().toISOString() }); });
  await runTransaction(keeperA.db, async (transaction) => { const snapshot = await transaction.get(doc(keeperA.db, "products", ids.unrelated)); transaction.update(snapshot.ref, { quantity: Number(snapshot.data().quantity) + 27, updatedAt: new Date().toISOString() }); transaction.set(doc(keeperA.db, "stockReceipts", `legacy-receipt-${suffix}`), { productId: ids.unrelated, batchId: `legacy-batch-${suffix}`, bulkQuantityReceived: 2, looseBaseQuantityReceived: 3, unitsPerBulk: 12, receivedQuantityBreakdown: { bulkQuantityReceived: 2, looseBaseQuantityReceived: 3, unitsPerBulk: 12, totalBaseQuantity: 27 }, quantityReceived: 27, receivedAt: new Date().toISOString() }); });
  const mixedLegacyReceipt = await getDoc(doc(admin.db, "stockReceipts", `legacy-receipt-${suffix}`));
  assert.equal(mixedLegacyReceipt.data().quantityReceived, 27);
  assert.equal(mixedLegacyReceipt.data().looseBaseQuantityReceived, 3);
  assert.equal((await getDoc(doc(admin.db, "products", ids.unrelated))).data().quantity, 30);

  const adjustment = { idempotencyKey: `simple-adjustment-${suffix}`, productId: ids.water, batchId: "", adjustmentType: "Damaged", quantity: 1, unit: "Bottle", reason: "Synthetic breakage", location: "Test shop", occurredAt: "2026-10-18T10:00" };
  const first = await keeperA.call("recordLegacyStockAdjustment")(adjustment);
  assert.deepEqual((await keeperB.call("recordLegacyStockAdjustment")(adjustment)).data, first.data);
  assert.equal((await getDoc(doc(keeperB.db, "stockAdjustments", first.data.adjustment.id))).data().baseQuantityAffected, 1);
  await assert.rejects(() => keeperB.call("recordLegacyStockAdjustment")({ ...adjustment, reason: "Conflict" }), failCode("already-exists"));
  await assert.rejects(() => sales.call("recordLegacyStockAdjustment")({ ...adjustment, idempotencyKey: `sales-adjustment-${suffix}` }), failCode("permission-denied"));
  await assert.rejects(() => setDoc(doc(keeperA.db, "stockAdjustments", `client-adjustment-${suffix}`), { productId: ids.water }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(keeperA.db, "stocktakeSessions", `client-report-${suffix}`), { status: "finalised" }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(manager.db, "settings", "weeklyStocktaking"), { scheduledWeekday: 6 }), (error) => error.code === "permission-denied");
  await assert.rejects(() => sales.call("startWeeklyStocktake")({ idempotencyKey: `simple-sales-start-${suffix}`, category }), failCode("permission-denied"));

  let report = (await keeperA.call("startWeeklyStocktake")({ idempotencyKey: `simple-start-${suffix}`, category })).data.session;
  assert.equal(report.items[0].snapshotBaseQuantity, 9);
  report = (await keeperA.call("saveWeeklyStocktakeCounts")({ sessionId: report.id, revision: report.revision, counts: [{ productId: ids.water, quantity: null, unit: "base" }] })).data.session;
  assert.equal((await getDoc(doc(keeperB.db, "stocktakeSessions", report.id))).data().items[0].actualBaseQuantity, null, "blank restores as not counted");
  report = (await keeperB.call("saveWeeklyStocktakeCounts")({ sessionId: report.id, revision: report.revision, counts: [{ productId: ids.water, quantity: 0, unit: "base" }] })).data.session;
  assert.equal(report.items[0].actualBaseQuantity, 0, "zero remains explicit");
  await assert.rejects(() => keeperA.call("saveWeeklyStocktakeCounts")({ sessionId: report.id, revision: report.revision - 1, counts: [{ productId: ids.water, quantity: 0, unit: "base" }] }), failCode("aborted"));
  await assert.rejects(() => keeperA.call("evaluateWeeklyStocktake")({ sessionId: report.id, revision: report.revision }), failCode("permission-denied"));
  report = (await manager.call("evaluateWeeklyStocktake")({ sessionId: report.id, revision: report.revision })).data.session;
  assert.equal(report.items[0].varianceBaseQuantity, -9);
  assert.equal((await getDoc(doc(keeperB.db, "products", ids.water))).data().quantity, 9, "evaluate cannot mutate inventory");
  await assert.rejects(() => manager.call("finaliseWeeklyStocktake")({ sessionId: report.id, revision: report.revision, reasons: [] }), failCode("failed-precondition"));
  report = (await manager.call("finaliseWeeklyStocktake")({ sessionId: report.id, revision: report.revision, reasons: [{ productId: ids.water, reason: "Shelf was empty" }] })).data.session;
  assert.equal(report.status, "finalised"); assert.equal((await getDoc(doc(keeperB.db, "products", ids.water))).data().quantity, 9);
  await assert.rejects(() => manager.call("finaliseWeeklyStocktake")({ sessionId: report.id, revision: report.revision, reasons: [] }), failCode("failed-precondition"));

  let moving = (await keeperA.call("startWeeklyStocktake")({ idempotencyKey: `simple-moving-start-${suffix}`, category: `${category} moving` })).data.session;
  moving = (await keeperA.call("saveWeeklyStocktakeCounts")({ sessionId: moving.id, revision: moving.revision, counts: [{ productId: ids.moving, quantity: 5, unit: "base" }] })).data.session;
  await updateDoc(doc(keeperB.db, "products", ids.moving), { quantity: 5, updatedAt: new Date().toISOString() }); // net-zero activity marker
  const staleMovement = await manager.call("evaluateWeeklyStocktake")({ sessionId: moving.id, revision: moving.revision });
  assert.equal(staleMovement.data.stale, true);

  let conversion = (await keeperA.call("startWeeklyStocktake")({ idempotencyKey: `simple-conversion-start-${suffix}`, category: `${category} conversion` })).data.session;
  conversion = (await keeperA.call("saveWeeklyStocktakeCounts")({ sessionId: conversion.id, revision: conversion.revision, counts: [{ productId: ids.conversion, quantity: 6, unit: "base" }] })).data.session;
  await updateDoc(doc(keeperB.db, "products", ids.conversion), { unitsPerBulk: 6, updatedAt: new Date().toISOString() });
  assert.equal((await manager.call("evaluateWeeklyStocktake")({ sessionId: conversion.id, revision: conversion.revision })).data.stale, true);
  await assert.rejects(() => keeperA.call("startWeeklyStocktake")({ idempotencyKey: `simple-v2-start-${suffix}`, category: `${category} v2` }), failCode("failed-precondition"));

  await admin.call("updateWeeklyStocktakeSchedule")({ scheduledWeekday: 1 });
  assert.equal((await getDoc(doc(admin.db, "settings", "weeklyStocktaking"))).data().scheduledWeekday, 1);
  console.log(`PASS: simplified stocktaking drafts, fresh-client restore, variance evaluation, finalisation, stale movement/conversion detection, permissions, rule denials, and adjustment regression verified in ${DEMO_EMULATOR_PROJECT_ID}.`);
} finally {
  if (originalSecure) await setDoc(doc(admin.db, "settings", "secureSales"), originalSecure);
  await close();
}
