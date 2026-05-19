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
import { createAppError, ERROR_FLAGS, normalizeFirebaseError } from "../utils/errorUtils.js";

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

  try {
    await setDoc(
      productRef,
      {
        ...toCloudProduct(product),
        createdAt: product.createdAt || serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save the product to Firestore. Check your connection and try again.");
  }

  return productRef;
}

export async function fetchProductsFromCloud() {
  try {
    const snapshot = await getDocs(productsCollection);
    return snapshot.docs.map(fromCloudProduct);
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load products from Firestore. Check your connection and try again.");
  }
}

export async function fetchStockReceiptsFromCloud() {
  try {
    const snapshot = await getDocs(stockReceiptsCollection);
    return snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data()
    }));
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load stock receipts from Firestore. Check your connection and try again.");
  }
}

export async function fetchSalesFromCloud() {
  try {
    const snapshot = await getDocs(salesCollection);
    return snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data()
    }));
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load sales from Firestore. Check your connection and try again.");
  }
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

  try {
    await batch.commit();
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save the stock receipt to Firestore. Check your connection and try again.");
  }

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

  try {
    await batch.commit();
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save the purchase to Firestore. Check your connection and try again.");
  }

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

  try {
    return await runTransaction(db, async (transaction) => {
      const productSnapshots = [];

      for (const [productId, quantity] of deductionsByProduct.entries()) {
        const productRef = doc(db, "products", productId);
        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists()) {
          throw createAppError("This product could not be found in Firestore. Refresh inventory and try again.", {
            code: "firestore/product-not-found",
            source: ERROR_FLAGS.SOURCE_FIRESTORE
          });
        }

        const productData = productSnapshot.data();
        const currentQuantity = Number(productData.quantity || 0);

        if (currentQuantity < quantity) {
          throw createAppError(`Not enough stock for ${productData.name || "this product"}. Refresh inventory and try again.`, {
            code: "inventory/insufficient-cloud-stock",
            source: ERROR_FLAGS.SOURCE_FIRESTORE
          });
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
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to complete the sale in Firestore. Check stock availability and try again.");
  }
}
