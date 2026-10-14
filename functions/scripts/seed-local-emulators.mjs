import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  DEMO_EMULATOR_PROJECT_ID,
  LOCAL_EMULATOR_ENDPOINTS,
  assertLocalEmulatorTarget
} from "../../js/utils/emulatorConfig.mjs";

const DEMO_PASSWORD = "DemoPass!123";

const demoUsers = [
  { uid: "demo-admin", email: "admin@demo.jyaano.test", fullName: "Demo Admin", username: "demo.admin", role: "admin" },
  { uid: "demo-manager", email: "manager@demo.jyaano.test", fullName: "Demo Manager", username: "demo.manager", role: "manager" },
  { uid: "demo-sales", email: "sales@demo.jyaano.test", fullName: "Demo Sales", username: "demo.sales", role: "sales" },
  { uid: "demo-storekeeper", email: "storekeeper@demo.jyaano.test", fullName: "Demo Storekeeper", username: "demo.storekeeper", role: "storekeeper" }
];

function parseHostPort(value, service) {
  const [host, port] = String(value || "").trim().split(":");

  if (!host || !port || !/^\d+$/.test(port)) {
    throw new Error(`${service} emulator host must be in host:port form.`);
  }

  return { host, port: Number(port) };
}

function parseFunctionsEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    return { host: url.hostname, port: Number(url.port || 80) };
  } catch {
    throw new Error("Functions emulator URL must be a valid URL.");
  }
}

async function assertEndpointReachable(service, endpoint) {
  const response = await fetch(`http://${endpoint.host}:${endpoint.port}`, {
    signal: AbortSignal.timeout(3000)
  }).catch((error) => {
    throw new Error(`${service} emulator is not reachable at ${endpoint.host}:${endpoint.port}: ${error.message}`);
  });

  if (!response) {
    throw new Error(`${service} emulator did not return a response.`);
  }
}

function getValidatedTarget() {
  const projectId = String(process.env.GCLOUD_PROJECT || "").trim();
  const endpoints = {
    auth: parseHostPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, "Auth"),
    firestore: parseHostPort(process.env.FIRESTORE_EMULATOR_HOST, "Firestore"),
    functions: parseFunctionsEndpoint(process.env.FUNCTIONS_EMULATOR_URL)
  };

  assertLocalEmulatorTarget(projectId, endpoints);
  return { projectId, endpoints };
}

async function ensureDemoUser(auth, user) {
  const userRecord = {
    email: user.email,
    password: DEMO_PASSWORD,
    displayName: user.fullName,
    disabled: false
  };

  try {
    await auth.updateUser(user.uid, userRecord);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      throw error;
    }

    await auth.createUser({ uid: user.uid, ...userRecord });
  }
}

async function seed() {
  const { projectId, endpoints } = getValidatedTarget();

  for (const [service, endpoint] of Object.entries(endpoints)) {
    await assertEndpointReachable(service, endpoint);
  }

  if (projectId !== DEMO_EMULATOR_PROJECT_ID) {
    throw new Error("Refusing to seed a non-demo Firebase project.");
  }

  const app = getApps()[0] || initializeApp({ projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);
  const seededAt = new Date().toISOString();

  for (const user of demoUsers) {
    await ensureDemoUser(auth, user);
    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      email: user.email,
      fullName: user.fullName,
      displayName: user.fullName,
      username: user.username,
      role: user.role,
      active: true,
      isActive: true,
      mustChangePassword: false,
      credentialSetupMode: null,
      createdAt: seededAt,
      updatedAt: seededAt
    }, { merge: true });
  }

  await Promise.all([
    db.collection("products").doc("demo-water").set({
      name: "Demo Mineral Water",
      category: "Water",
      baseUnit: "Bottle",
      bulkUnit: "Carton",
      unitsPerBulk: 12,
      quantity: 48,
      lowStockThreshold: 10,
      costPrice: 4,
      bulkCostPrice: 48,
      sellingPrice: 6,
      bulkSellingPrice: 72,
      active: true,
      createdAt: seededAt,
      updatedAt: seededAt
    }, { merge: true }),
    db.collection("stockReceipts").doc("demo-receipt-001").set({
      productId: "demo-water",
      product: "Demo Mineral Water",
      quantityReceived: 48,
      supplier: "Demo Supplier",
      paymentStatus: "Paid",
      purchaseDate: seededAt,
      receivedAt: seededAt,
      createdAt: seededAt
    }, { merge: true }),
    db.collection("sales").doc("demo-sale-001").set({
      items: [{ productId: "demo-water", productName: "Demo Mineral Water", quantity: 2, total: 12 }],
      totalAmount: 12,
      total: 12,
      soldBy: "Demo Sales",
      createdAt: seededAt,
      date: seededAt
    }, { merge: true }),
    db.collection("suppliers").doc("demo-supplier").set({
      name: "Demo Supplier",
      contactPerson: "Demo Contact",
      phone: "0000000000",
      createdAt: seededAt,
      updatedAt: seededAt
    }, { merge: true }),
    db.collection("settings").doc("categories").set({ categories: ["Water", "Soft Drink", "Juice"] }, { merge: true }),
    db.collection("settings").doc("tax").set({
      enabled: true,
      vatRate: 15,
      nhilRate: 2.5,
      getfundRate: 2.5,
      withholdingVatRate: 7,
      taxMode: "standard"
    }, { merge: true })
  ]);

  console.log(`PASS: seeded ${demoUsers.length} synthetic accounts and demo inventory in ${projectId}.`);
  console.log(`All demo accounts use password: ${DEMO_PASSWORD}`);
}

await seed();
