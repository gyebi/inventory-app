import { db } from "../firebase.js";
import { collection, onSnapshot } from "firebase/firestore";

function listenToCollection(path, onChange, onError) {
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const records = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data()
      }));
      onChange(records);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export function listenToProducts(onChange, onError) {
  return listenToCollection("products", onChange, onError);
}

export function listenToStockReceipts(onChange, onError) {
  return listenToCollection("stockReceipts", onChange, onError);
}

export function listenToSales(onChange, onError) {
  return listenToCollection("sales", onChange, onError);
}

export function listenToUsers(onChange, onError) {
  return listenToCollection("users", onChange, onError);
}

export function listenToSuppliers(onChange, onError) {
  return listenToCollection("suppliers", onChange, onError);
}

export function listenToSupplierPayments(onChange, onError) {
  return listenToCollection("supplierPayments", onChange, onError);
}
