import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";

export async function getUserProfile(uid) {
  if (!uid) {
    throw new Error("Missing user UID");
  }

  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    throw new Error("User profile not found");
  }

  return {
    uid: snapshot.id,
    ...snapshot.data()
  };
}