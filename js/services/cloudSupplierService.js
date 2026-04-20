import { db } from "../firebase.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

const suppliersCollection = collection(db, "suppliers");

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
