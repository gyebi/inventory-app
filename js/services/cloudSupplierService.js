import { db } from "../firebase.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { normalizeFirebaseError } from "../utils/errorUtils.js";

const suppliersCollection = collection(db, "suppliers");
const supplierPaymentsCollection = collection(db, "supplierPayments");

const toCloudSupplier = (supplier) => ({
  name: supplier.name,
  contactPerson: supplier.contactPerson || "",
  phone: supplier.phone || "",
  email: supplier.email || "",
  address: supplier.address || "",
  notes: supplier.notes || "",
  updatedAt: serverTimestamp(),
  createdBy: supplier.createdBy || null
});

const fromCloudSupplier = (snapshot) => ({
  id: snapshot.id,
  ...snapshot.data()
});

export async function saveSupplierToCloud(supplier) {
  const supplierRef = doc(db, "suppliers", supplier.id);

  try {
    await setDoc(
      supplierRef,
      {
        ...toCloudSupplier(supplier),
        createdAt: supplier.createdAt || serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save the supplier to Firestore. Check your connection and try again.");
  }

  return supplierRef;
}

export async function fetchSuppliersFromCloud() {
  try {
    const snapshot = await getDocs(suppliersCollection);
    return snapshot.docs.map(fromCloudSupplier);
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load suppliers from Firestore. Check your connection and try again.");
  }
}

export async function saveSupplierPaymentToCloud(payment) {
  const paymentRef = doc(db, "supplierPayments", payment.id);

  try {
    await setDoc(
      paymentRef,
      {
        supplier: payment.supplier || "",
        invoiceReference: payment.invoiceReference || "",
        paymentDate: payment.paymentDate || "",
        amountPaid: Number(payment.amountPaid || 0),
        paymentMethod: payment.paymentMethod || "",
        referenceNumber: payment.referenceNumber || "",
        discountReceived: Number(payment.discountReceived || 0),
        penaltyCharge: Number(payment.penaltyCharge || 0),
        notes: payment.notes || "",
        createdAt: payment.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: payment.createdBy || null
      },
      { merge: true }
    );
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to save the supplier payment to Firestore. Check your connection and try again.");
  }

  return paymentRef;
}

export async function fetchSupplierPaymentsFromCloud() {
  try {
    const snapshot = await getDocs(supplierPaymentsCollection);
    return snapshot.docs.map(fromCloudSupplier);
  } catch (error) {
    throw normalizeFirebaseError(error, "Unable to load supplier payments from Firestore. Check your connection and try again.");
  }
}
