import { db } from "../firebase.js";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc
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

  return runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productRef);

    if (!productSnapshot.exists()) {
      throw new Error("Product not found in Firestore.");
    }

    const productData = productSnapshot.data();
    const nextQuantity = Number(productData.quantity || 0) + Number(quantityReceived || 0);

    transaction.update(productRef, {
      quantity: nextQuantity,
      updatedAt: serverTimestamp()
    });

    transaction.set(receiptRef, {
      ...receipt,
      id: receiptRef.id,
      productId,
      quantityReceived: Number(quantityReceived || 0),
      createdAt: serverTimestamp()
    });

    return {
      id: productId,
      ...productData,
      quantity: nextQuantity
    };
  });
}

export async function submitSaleToCloudTransaction({
  sale,
  stockDeductions
}) {
  const saleRef = doc(db, "sales", sale.id);

  return runTransaction(db, async (transaction) => {
    for (const deduction of stockDeductions) {
      const productRef = doc(db, "products", deduction.productId);
      const productSnapshot = await transaction.get(productRef);

      if (!productSnapshot.exists()) {
        throw new Error(`Product not found in Firestore: ${deduction.productId}`);
      }

      const productData = productSnapshot.data();
      const currentQuantity = Number(productData.quantity || 0);

      if (currentQuantity < deduction.quantity) {
        throw new Error(`Not enough stock for ${productData.name || "product"}.`);
      }

      transaction.update(productRef, {
        quantity: currentQuantity - deduction.quantity,
        updatedAt: serverTimestamp()
      });
    }

    transaction.set(saleRef, {
      ...sale,
      cloudSyncedAt: serverTimestamp()
    });
  });
}
