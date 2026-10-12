"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Module = require("node:module");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const state = {
  documents: new Map(),
  authUsersByEmail: new Map(),
  authUsersByUid: new Map(),
  createdUsers: [],
  deletedUsers: [],
  resetLinks: []
};

function resetState() {
  state.documents.clear();
  state.authUsersByEmail.clear();
  state.authUsersByUid.clear();
  state.createdUsers.length = 0;
  state.deletedUsers.length = 0;
  state.resetLinks.length = 0;
}

function documentKey(collection, id) {
  return `${collection}/${id}`;
}

function snapshotFor(collection, id) {
  const record = state.documents.get(documentKey(collection, id));

  return {
    id,
    exists: Boolean(record),
    data: () => record && { ...record },
    ref: documentRef(collection, id)
  };
}

function documentRef(collection, id) {
  return {
    get: async () => snapshotFor(collection, id),
    set: async (value, options = {}) => {
      const key = documentKey(collection, id);
      const existing = state.documents.get(key) || {};
      state.documents.set(key, options.merge ? { ...existing, ...value } : { ...value });
    },
    delete: async () => {
      state.documents.delete(documentKey(collection, id));
    }
  };
}

function querySnapshot(collection, filters) {
  const docs = [];

  for (const [key, data] of state.documents.entries()) {
    const [documentCollection, id] = key.split("/");

    if (documentCollection !== collection) {
      continue;
    }

    if (filters.every(({ field, value }) => data[field] === value)) {
      docs.push(snapshotFor(collection, id));
    }
  }

  return {
    docs,
    empty: docs.length === 0
  };
}

function collectionRef(collection) {
  const filters = [];
  const query = {
    where: (field, operator, value) => {
      assert.equal(operator, "==", "The mock supports equality queries used by the functions.");
      filters.push({ field, value });
      return query;
    },
    limit: () => query,
    get: async () => querySnapshot(collection, filters)
  };

  return {
    doc: (id) => documentRef(collection, id),
    where: query.where,
    limit: query.limit
  };
}

function fakeFirestore() {
  return {
    collection: collectionRef
  };
}

const fakeFieldValue = {
  serverTimestamp: () => "<server-timestamp>"
};

function fakeAuth() {
  return {
    getUserByEmail: async (email) => {
      const user = state.authUsersByEmail.get(email);

      if (!user) {
        const error = new Error("User not found");
        error.code = "auth/user-not-found";
        throw error;
      }

      return user;
    },
    getUser: async (uid) => {
      const user = state.authUsersByUid.get(uid);

      if (!user) {
        const error = new Error("User not found");
        error.code = "auth/user-not-found";
        throw error;
      }

      return user;
    },
    createUser: async (payload) => {
      state.createdUsers.push(payload);
      return {
        uid: "new-staff-user",
        ...payload,
        providerData: [{ providerId: "password" }]
      };
    },
    deleteUser: async (uid) => {
      state.deletedUsers.push(uid);
    },
    generatePasswordResetLink: async (email, settings) => {
      state.resetLinks.push({ email, settings });
      return "https://example.invalid/password-reset";
    }
  };
}

function onCall(options, handler) {
  const callable = async (request) => handler(request);
  callable.run = handler;
  callable.options = options;
  return callable;
}

const originalLoad = Module._load;
Module._load = function loadWithFirebaseMocks(request, parent, isMain) {
  if (request === "firebase-functions/v2/https") {
    return { onCall, HttpsError: FakeHttpsError };
  }

  if (request === "firebase-functions/logger") {
    return { error: () => undefined };
  }

  if (request === "firebase-admin/app") {
    return { initializeApp: () => undefined };
  }

  if (request === "firebase-admin/auth") {
    return { getAuth: fakeAuth };
  }

  if (request === "firebase-admin/firestore") {
    return { FieldValue: fakeFieldValue, getFirestore: fakeFirestore };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const functionsUnderTest = require("../index.js");
Module._load = originalLoad;

async function expectHttpsError(action, code) {
  await assert.rejects(action, (error) => error instanceof FakeHttpsError && error.code === code);
}

test.beforeEach(resetState);

test("createStaffUser rejects unauthenticated callers", async () => {
  await expectHttpsError(
    () => functionsUnderTest.createStaffUser.run({ data: { staff: {} } }),
    "unauthenticated"
  );
});

test("createStaffUser rejects authenticated non-admin callers", async () => {
  state.documents.set(documentKey("users", "sales-user"), {
    uid: "sales-user",
    role: "sales"
  });

  await expectHttpsError(
    () => functionsUnderTest.createStaffUser.run({ auth: { uid: "sales-user" }, data: { staff: {} } }),
    "permission-denied"
  );
});

test("createStaffUser rejects an invalid staff role before creating an Auth user", async () => {
  state.documents.set(documentKey("users", "admin-user"), {
    uid: "admin-user",
    role: "admin"
  });

  await expectHttpsError(
    () => functionsUnderTest.createStaffUser.run({
      auth: { uid: "admin-user" },
      data: {
        staff: {
          fullName: "New Staff",
          email: "new.staff@example.invalid",
          role: "owner"
        }
      }
    }),
    "invalid-argument"
  );

  assert.equal(state.createdUsers.length, 0);
});

test("createStaffUser rejects password setup links outside the allowed application origins", async () => {
  state.documents.set(documentKey("users", "admin-user"), {
    uid: "admin-user",
    role: "admin"
  });

  await expectHttpsError(
    () => functionsUnderTest.createStaffUser.run({
      auth: { uid: "admin-user" },
      data: {
        staff: {
          fullName: "New Staff",
          email: "new.staff@example.invalid",
          role: "manager",
          passwordSetupUrl: "https://attacker.example.invalid/reset"
        }
      }
    }),
    "invalid-argument"
  );

  assert.equal(state.createdUsers.length, 0);
});

test("createStaffUser creates an authorized staff profile with a temporary password", async () => {
  state.documents.set(documentKey("users", "admin-user"), {
    uid: "admin-user",
    role: "admin",
    fullName: "Primary Admin",
    email: "admin@example.invalid"
  });

  const result = await functionsUnderTest.createStaffUser.run({
    auth: { uid: "admin-user" },
    data: {
      staff: {
        fullName: "New Staff",
        email: "NEW.STAFF@example.invalid",
        username: "new-staff",
        role: "manager",
        temporaryPassword: "temporary-password"
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.email, "new.staff@example.invalid");
  assert.equal(result.user.role, "manager");
  assert.equal(result.user.mustChangePassword, true);
  assert.equal(state.createdUsers.length, 1);
  assert.deepEqual(state.createdUsers[0], {
    email: "new.staff@example.invalid",
    password: "temporary-password",
    displayName: "New Staff",
    disabled: false
  });
  assert.equal(state.documents.get(documentKey("users", "new-staff-user")).createdBy.uid, "admin-user");
});

test("ensureSignedInUserProfile rejects unauthenticated callers", async () => {
  await expectHttpsError(
    () => functionsUnderTest.ensureSignedInUserProfile.run({}),
    "unauthenticated"
  );
});

test("clearRequiredPasswordChange only permits an authenticated user to update their own profile", async () => {
  state.documents.set(documentKey("users", "staff-user"), {
    uid: "staff-user",
    role: "sales",
    mustChangePassword: true
  });

  const result = await functionsUnderTest.clearRequiredPasswordChange.run({
    auth: { uid: "staff-user" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.uid, "staff-user");
  assert.equal(state.documents.get(documentKey("users", "staff-user")).mustChangePassword, false);
  assert.equal(state.documents.has(documentKey("users", "other-user")), false);
});

test("clearRequiredPasswordChange rejects unauthenticated callers", async () => {
  await expectHttpsError(
    () => functionsUnderTest.clearRequiredPasswordChange.run({}),
    "unauthenticated"
  );
});
