import { db } from "../firebase.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

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

  await setDoc(
    supplierRef,
    {
      ...toCloudSupplier(supplier),
      createdAt: supplier.createdAt || serverTimestamp()
    },
    { merge: true }
  );

  return supplierRef;
}

export async function fetchSuppliersFromCloud() {
  const snapshot = await getDocs(suppliersCollection);
  return snapshot.docs.map(fromCloudSupplier);
}

export async function saveSupplierPaymentToCloud(payment) {
  const paymentRef = doc(db, "supplierPayments", payment.id);

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

  return paymentRef;
}

export async function fetchSupplierPaymentsFromCloud() {
  const snapshot = await getDocs(supplierPaymentsCollection);
  return snapshot.docs.map(fromCloudSupplier);
}
