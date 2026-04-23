import { db } from "../firebase.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc
} from "firebase/firestore";

const usersCollection = collection(db, "users");

const toCloudUser = (user) => ({
  fullName: user.fullName,
  username: user.username,
  email: user.email || "",
  role: user.role,
  active: user.active !== false && user.isActive !== false,
  pendingAuthCreation: user.pendingAuthCreation === true,
  mustChangePassword: user.mustChangePassword === true,
  credentialSetupMode: user.credentialSetupMode || null,
  updatedAt: serverTimestamp(),
  createdBy: user.createdBy || null
});

const fromCloudUser = (snapshot) => ({
  id: snapshot.id,
  ...snapshot.data()
});

export async function saveUserToCloud(user) {
  const userRef = doc(db, "users", user.id);

  await setDoc(
    userRef,
    {
      ...toCloudUser(user),
      createdAt: user.createdAt || serverTimestamp()
    },
    { merge: true }
  );

  return userRef;
}

export async function fetchUsersFromCloud() {
  const snapshot = await getDocs(usersCollection);
  return snapshot.docs.map(fromCloudUser);
}
