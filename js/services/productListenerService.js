import { db } from "../firebase.js";
import { collection, doc, onSnapshot } from "firebase/firestore";

function listenToCollection(path, onChange, onError) {
  return onSnapshot(
    collection(db, path),
    { includeMetadataChanges: true },
    (snapshot) => {
      const records = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data()
      }));
      onChange(records, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites
      });
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

export function listenToStockBatches(onChange, onError) {
  return listenToCollection("stockBatches", onChange, onError);
}

export function listenToSales(onChange, onError) {
  return listenToCollection("sales", onChange, onError);
}

export function listenToStockAdjustments(onChange, onError) {
  return listenToCollection("stockAdjustments", onChange, onError);
}

export function listenToStocktakeSessions(onChange, onError) {
  return listenToCollection("stocktakeSessions", onChange, onError);
}

export function listenToWeeklyStocktakingSettings(onChange, onError) {
  return onSnapshot(doc(db, "settings", "weeklyStocktaking"), { includeMetadataChanges: true }, (snapshot) => {
    onChange(snapshot.exists() ? snapshot.data() : null, { fromCache: snapshot.metadata.fromCache, hasPendingWrites: snapshot.metadata.hasPendingWrites });
  }, onError);
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

export function listenToPriceChanges(onChange, onError) {
  return listenToCollection("priceChanges", onChange, onError);
}
