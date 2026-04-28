import { db } from "../firebase.js";
import {
  collection,
  doc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch
} from "firebase/firestore";

const productsCollection = collection(db, "products");
const salesCollection = collection(db, "sales");
const stockReceiptsCollection = collection(db, "stockReceipts");

const toCloudProduct = (product) => ({
  name: product.name,
  category: product.category || "",
  baseUnit: product.baseUnit || "Bottle",
  bulkUnit: product.bulkUnit || "Carton",
  unitsPerBulk: Number(product.unitsPerBulk || 1),
  quantity: Number(product.quantity || 0),
  costPrice: Number(product.costPrice || 0),
  sellingPrice: Number(product.sellingPrice || 0),
  bulkCostPrice: Number(product.bulkCostPrice || 0),
  bulkSellingPrice: Number(product.bulkSellingPrice || 0),
  lowStockThreshold: Number(product.lowStockThreshold || 10),
  updatedAt: serverTimestamp()
});

const fromCloudProduct = (snapshot) => ({
  id: snapshot.id,
  ...snapshot.data()
});

export async function saveProductToCloud(product) {
  const productRef = doc(db, "products", product.id);

  await setDoc(
    productRef,
    {
      ...toCloudProduct(product),
      createdAt: product.createdAt || serverTimestamp()
    },
    { merge: true }
  );

  return productRef;
}

export async function fetchProductsFromCloud() {
  const snapshot = await getDocs(productsCollection);
  return snapshot.docs.map(fromCloudProduct);
}

export async function fetchStockReceiptsFromCloud() {
  const snapshot = await getDocs(stockReceiptsCollection);
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data()
  }));
}

export async function fetchSalesFromCloud() {
  const snapshot = await getDocs(salesCollection);
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data()
  }));
}

export async function receiveStockInCloudTransaction({
  productId,
  quantityReceived,
  receipt
}) {
  const productRef = doc(db, "products", productId);
  const receiptRef = doc(stockReceiptsCollection);
  const receivedQuantity = Number(quantityReceived || 0);
  const batch = writeBatch(db);

  batch.update(productRef, {
    quantity: increment(receivedQuantity),
    updatedAt: serverTimestamp()
  });

  batch.set(receiptRef, {
    ...receipt,
    id: receiptRef.id,
    productId,
    quantityReceived: receivedQuantity,
    createdAt: serverTimestamp()
  });

  await batch.commit();

  return {
    id: productId,
    quantityReceived: receivedQuantity,
    receiptId: receiptRef.id
  };
}

export async function receivePurchaseInCloudTransaction({ lines = [] }) {
  const batch = writeBatch(db);
  const savedLines = [];

  lines.forEach((line) => {
    const productRef = doc(db, "products", line.productId);
    const receiptRef = doc(stockReceiptsCollection);
    const receivedQuantity = Number(line.quantityReceived || 0);

    batch.update(productRef, {
      quantity: increment(receivedQuantity),
      updatedAt: serverTimestamp()
    });

    batch.set(receiptRef, {
      ...line.receipt,
      id: receiptRef.id,
      productId: line.productId,
      quantityReceived: receivedQuantity,
      createdAt: serverTimestamp()
    });

    savedLines.push({
      productId: line.productId,
      quantityReceived: receivedQuantity,
      receiptId: receiptRef.id,
      batchId: line.receipt?.batchId
    });
  });

  await batch.commit();

  return {
    lines: savedLines
  };
}

export async function submitSaleToCloudTransaction({
  sale,
  stockDeductions
}) {
  const saleRef = doc(db, "sales", sale.id);
  const deductionsByProduct = stockDeductions.reduce((map, deduction) => {
    map.set(
      deduction.productId,
      (map.get(deduction.productId) || 0) + Number(deduction.quantity || 0)
    );
    return map;
  }, new Map());

  return runTransaction(db, async (transaction) => {
    const productSnapshots = [];

    for (const [productId, quantity] of deductionsByProduct.entries()) {
      const productRef = doc(db, "products", productId);
      const productSnapshot = await transaction.get(productRef);

      if (!productSnapshot.exists()) {
        throw new Error(`Product not found in Firestore: ${productId}`);
      }

      const productData = productSnapshot.data();
      const currentQuantity = Number(productData.quantity || 0);

      if (currentQuantity < quantity) {
        throw new Error(`Not enough stock for ${productData.name || "product"}.`);
      }

      productSnapshots.push({
        productRef,
        productData,
        quantity
      });
    }

    for (const { productRef, productData, quantity } of productSnapshots) {
      transaction.update(productRef, {
        quantity: Number(productData.quantity || 0) - quantity,
        updatedAt: serverTimestamp()
      });
    }

    transaction.set(saleRef, {
      ...sale,
      cloudSyncedAt: serverTimestamp()
    });
  });
}
