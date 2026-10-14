import assert from "node:assert/strict";
import test from "node:test";
import { createUserProfileService } from "../js/services/userProfileServiceCore.js";

const uid = "staff-123";

function profileSnapshot(data = { role: "sales", active: true }) {
  return {
    id: uid,
    exists: () => true,
    data: () => data
  };
}

function missingSnapshot() {
  return {
    exists: () => false,
    data: () => undefined
  };
}

function createService({ getDoc, callable = async () => {}, currentUser = { uid } }) {
  let callableRequests = 0;
  const service = createUserProfileService({
    auth: { currentUser },
    db: {},
    doc: (_db, collection, documentId) => ({ collection, id: documentId }),
    getDoc,
    functions: {},
    httpsCallable: () => async (payload) => {
      callableRequests += 1;
      return callable(payload);
    }
  });

  return {
    ...service,
    get callableRequests() {
      return callableRequests;
    }
  };
}

test("getUserProfile returns a readable profile without initializing it", async () => {
  let readCount = 0;
  const service = createService({
    getDoc: async () => {
      readCount += 1;
      return profileSnapshot({ role: "manager", active: true });
    }
  });

  assert.deepEqual(await service.getUserProfile(uid), { uid, role: "manager", active: true });
  assert.equal(readCount, 1);
  assert.equal(service.callableRequests, 0);
});

test("getUserProfile initializes and rereads a missing profile once", async () => {
  let initialized = false;
  let readCount = 0;
  const service = createService({
    getDoc: async () => {
      readCount += 1;
      return initialized ? profileSnapshot() : missingSnapshot();
    },
    callable: async () => {
      initialized = true;
    }
  });

  assert.deepEqual(await service.getUserProfile(uid), { uid, role: "sales", active: true });
  assert.equal(readCount, 2);
  assert.equal(service.callableRequests, 1);
});

test("getUserProfile initializes after an initial permission-denied read", async () => {
  let initialized = false;
  let readCount = 0;
  const service = createService({
    getDoc: async () => {
      readCount += 1;
      if (!initialized) {
        throw { code: "permission-denied" };
      }
      return profileSnapshot();
    },
    callable: async () => {
      initialized = true;
    }
  });

  assert.deepEqual(await service.getUserProfile(uid), { uid, role: "sales", active: true });
  assert.equal(readCount, 2);
  assert.equal(service.callableRequests, 1);
});

test("getUserProfile only retries once after permission-denied", async () => {
  let initialized = false;
  let readCount = 0;
  const service = createService({
    getDoc: async () => {
      readCount += 1;
      if (!initialized) {
        throw { code: "permission-denied" };
      }
      return missingSnapshot();
    },
    callable: async () => {
      initialized = true;
    }
  });

  await assert.rejects(service.getUserProfile(uid), { code: "auth/profile-not-found" });
  assert.equal(readCount, 2);
  assert.equal(service.callableRequests, 1);
});

test("getUserProfile propagates profile initialization failures", async () => {
  const callableError = new Error("Profile migration failed");
  const service = createService({
    getDoc: async () => missingSnapshot(),
    callable: async () => {
      throw callableError;
    }
  });

  await assert.rejects(service.getUserProfile(uid), callableError);
  assert.equal(service.callableRequests, 1);
});

test("getUserProfile propagates unrelated Firestore read failures", async () => {
  const readError = Object.assign(new Error("Firestore unavailable"), { code: "unavailable" });
  const service = createService({
    getDoc: async () => {
      throw readError;
    }
  });

  await assert.rejects(service.getUserProfile(uid), readError);
  assert.equal(service.callableRequests, 0);
});

test("getUserProfile does not initialize a profile for a different signed-in user", async () => {
  const service = createService({
    currentUser: { uid: "another-staff-member" },
    getDoc: async () => missingSnapshot()
  });

  await assert.rejects(service.getUserProfile(uid), { code: "auth/current-user-mismatch" });
  assert.equal(service.callableRequests, 0);
});

test("concurrent missing-profile loads share one initialization request", async () => {
  let initialized = false;
  let resolveInitialization;
  let signalCallableStarted;
  const callableStarted = new Promise((resolve) => {
    signalCallableStarted = resolve;
  });
  const initialization = new Promise((resolve) => {
    resolveInitialization = () => {
      initialized = true;
      resolve();
    };
  });
  const service = createService({
    getDoc: async () => initialized ? profileSnapshot() : missingSnapshot(),
    callable: async () => {
      signalCallableStarted();
      await initialization;
    }
  });

  const firstLoad = service.getUserProfile(uid);
  const secondLoad = service.getUserProfile(uid);
  await callableStarted;
  assert.equal(service.callableRequests, 1);

  resolveInitialization();
  assert.deepEqual(await Promise.all([firstLoad, secondLoad]), [
    { uid, role: "sales", active: true },
    { uid, role: "sales", active: true }
  ]);
});
