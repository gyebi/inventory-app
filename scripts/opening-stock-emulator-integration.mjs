import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, runTransaction, setDoc, terminate } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { DEMO_EMULATOR_PROJECT_ID, LOCAL_EMULATOR_ENDPOINTS, SYNTHETIC_EMULATOR_FIREBASE_CONFIG, assertLocalEmulatorTarget } from "../js/utils/emulatorConfig.mjs";
import { resolvePersistedProductSellingPrice } from "../js/services/productPriceResolver.mjs";

assertLocalEmulatorTarget(process.env.GCLOUD_PROJECT, LOCAL_EMULATOR_ENDPOINTS);
const suffix = `${Date.now()}`;
const apps = [];
async function client(name, email) {
  const app = initializeApp(SYNTHETIC_EMULATOR_FIREBASE_CONFIG, `opening-stock-${name}-${suffix}`);
  apps.push(app);
  const auth = getAuth(app); const db = getFirestore(app); const functions = getFunctions(app, "us-central1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080); connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  await signInWithEmailAndPassword(auth, email, "DemoPass!123");
  return { auth, db, call: (name) => httpsCallable(functions, name) };
}
const failCode = (code) => (error) => String(error?.code || "").replace(/^functions\//, "") === code;
const admin = await client("admin", "admin@demo.jyaano.test");
const sales = await client("sales", "sales@demo.jyaano.test");
const keeper = await client("keeper", "storekeeper@demo.jyaano.test");
const productId = `opening-stock-water-${suffix}`;

try {
  const secure = await getDoc(doc(admin.db, "settings", "secureSales"));
  if (secure.exists() && secure.data()?.enabled === true) throw new Error("This guarded opening-stock integration requires the existing emulator to already be in legacy mode; it never changes secureSales.");
  const tax = await getDoc(doc(admin.db, "settings", "tax"));
  if (!tax.exists()) throw new Error("This guarded opening-stock integration requires existing saved tax settings; it never seeds shared settings.");
  await setDoc(doc(admin.db, "products", productId), { name: "Synthetic opening water", category: "Synthetic opening", baseUnit: "Bottle", bulkUnit: "Pack", unitsPerBulk: 12, quantity: 0, active: true, createdAt: new Date().toISOString() });
  const setup = { productId, baseUnit: "Bottle", bulkUnit: "Pack", unitsPerBulk: 12, basePricePesewas: 300, bulkPricePesewas: 3600, expectedRevision: 0, confirmUncounted: true };
  await assert.rejects(() => sales.call("configureOpeningStockProduct")(setup), failCode("permission-denied"));
  const configured = await admin.call("configureOpeningStockProduct")(setup);
  assert.equal(configured.data.setup.status, "unverified");
  await assert.rejects(() => setDoc(doc(sales.db, "openingStockProducts", productId), { status: "verified" }), (error) => error.code === "permission-denied");
  const quote = await sales.call("quoteOpeningStockSale")({ items: [{ productId, quantity: 2, unit: "bulk" }], paymentMethod: "cash" });
  assert.equal(quote.data.sale.items[0].actualQtySold, 24);
  const salePayload = { idempotencyKey: `opening-stock-sale-${suffix}`, items: [{ productId, quantity: 2, unit: "bulk" }], paymentMethod: "cash", expectedQuoteFingerprint: quote.data.quoteFingerprint };
  const first = await sales.call("submitOpeningStockSale")(salePayload);
  const retry = await sales.call("submitOpeningStockSale")(salePayload);
  assert.deepEqual(retry.data, first.data);
  await assert.rejects(() => sales.call("submitOpeningStockSale")({ ...salePayload, items: [{ productId, quantity: 3, unit: "bulk" }] }), failCode("already-exists"));
  const savedSale = await getDoc(doc(admin.db, "sales", first.data.saleId));
  assert.equal(savedSale.data()?.openingStock, true);
  assert.equal(savedSale.data()?.profit, null);
  assert.equal((await getDoc(doc(admin.db, "products", productId))).data()?.quantity, 0);
  const started = await admin.call("startOpeningStockCount")({ productId, expectedRevision: 1 });
  await assert.rejects(() => sales.call("quoteOpeningStockSale")({ items: [{ productId, quantity: 1, unit: "base" }], paymentMethod: "cash" }), failCode("failed-precondition"));
  await assert.rejects(() => setDoc(doc(sales.db, "products", productId), { quantity: 1 }, { merge: true }), (error) => error.code === "permission-denied");
  await assert.rejects(() => setDoc(doc(keeper.db, "stockReceipts", `opening-receipt-${suffix}`), { productId, quantityReceived: 1 }), (error) => error.code === "permission-denied");
  await assert.rejects(() => keeper.call("recordLegacyStockAdjustment")({ idempotencyKey: `opening-adjustment-${suffix}`, productId, batchId: "", adjustmentType: "Damaged", quantity: 1, unit: "Bottle", reason: "Synthetic", location: "Test", occurredAt: "2026-10-18T10:00" }), failCode("failed-precondition"));
  await admin.call("cancelOpeningStockCount")({ productId, expectedRevision: started.data.count.setupRevision });
  const restarted = await admin.call("startOpeningStockCount")({ productId, expectedRevision: 3 });
  const confirmed = await admin.call("confirmOpeningStockCount")({ productId, expectedRevision: restarted.data.count.setupRevision, batches: [{ reference: "Shelf A", baseQuantity: 12 }, { reference: "Shelf B", baseQuantity: 3 }] });
  assert.equal(confirmed.data.balance.totalBaseQuantity, 15);
  const balance = await getDoc(doc(admin.db, "openingStockBalances", productId));
  assert.equal(balance.data()?.costStatus, "unknown");
  assert.equal(balance.data()?.batches[0]?.expiryDate, null);
  const reloaded = await client("reloaded-sales", "sales@demo.jyaano.test");
  const activatedProduct = (await getDoc(doc(reloaded.db, "products", productId))).data();
  assert.equal(activatedProduct?.quantity, 15);
  assert.equal(resolvePersistedProductSellingPrice(activatedProduct, "base"), 3);
  assert.equal(resolvePersistedProductSellingPrice(activatedProduct, "bulk"), 36);
  const normalSaleId = `normal-opening-sale-${suffix}`;
  await runTransaction(reloaded.db, async (transaction) => {
    const productRef = doc(reloaded.db, "products", productId);
    const productSnapshot = await transaction.get(productRef);
    const product = productSnapshot.data();
    const unitPrice = resolvePersistedProductSellingPrice(product, "base");
    assert.equal(unitPrice, 3);
    assert.equal(unitPrice * 3, 9);
    assert.equal(product.quantity, 15);
    transaction.update(productRef, { quantity: product.quantity - 3, updatedAt: new Date().toISOString() });
    transaction.set(doc(reloaded.db, "sales", normalSaleId), {
      id: normalSaleId,
      productId,
      openingStock: false,
      items: [{ productId, quantity: 3, saleUnit: "base", unit: "Bottle", unitPrice, total: unitPrice * 3, actualQtySold: 3, batchAllocations: [{ batchId: balance.data()?.batches[0]?.id, quantity: 3 }] }],
      subtotalAmount: unitPrice * 3,
      createdAt: new Date().toISOString()
    });
  });
  assert.equal((await getDoc(doc(admin.db, "sales", normalSaleId))).data()?.subtotalAmount, 9);
  assert.equal((await getDoc(doc(admin.db, "products", productId))).data()?.quantity, 12);
  const afterSaleReload = await client("after-sale-reload", "sales@demo.jyaano.test");
  const afterSaleProduct = (await getDoc(doc(afterSaleReload.db, "products", productId))).data();
  assert.equal(afterSaleProduct?.quantity, 12);
  assert.equal(resolvePersistedProductSellingPrice(afterSaleProduct, "base"), 3);
  assert.equal(resolvePersistedProductSellingPrice(afterSaleProduct, "bulk"), 36);
  await assert.rejects(() => setDoc(doc(sales.db, "openingStockBalances", productId), { productId, totalBaseQuantity: 999 }), (error) => error.code === "permission-denied");
  console.log(`PASS: authenticated opening-stock setup, quote, immutable idempotent sale, count lock, approved-price activation/reload, normal sale balance, and direct-write denials verified in ${DEMO_EMULATOR_PROJECT_ID}.`);
} finally {
  await Promise.all(apps.map(async (app) => { await terminate(getFirestore(app)); await deleteApp(app); }));
}
