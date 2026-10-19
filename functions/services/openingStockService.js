"use strict";

function createOpeningStockService({ db, FieldValue, HttpsError }) {
  function fail(code, message) {
    throw new HttpsError(code, message);
  }

  function validateSetup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("invalid-argument", "Product setup is required.");
    }

    const allowed = new Set([
      "productId", "baseUnit", "bulkUnit", "unitsPerBulk",
      "basePricePesewas", "bulkPricePesewas", "expectedRevision",
      "confirmUncounted"
    ]);

    if (Object.keys(data).some((key) => !allowed.has(key))) {
      fail("invalid-argument", "Unsupported product setup field.");
    }

    const productId = data.productId;
    if (typeof productId !== "string" ||
        !productId || productId.length > 128 ||
        productId.includes("/") || productId !== productId.trim()) {
      fail("invalid-argument", "A valid product ID is required.");
    }

    function unit(value, field) {
      if (typeof value !== "string" ||
          !value.trim() || value.trim().length > 40 ||
          /[\x00-\x1f\x7f]/.test(value)) {
        fail("invalid-argument", field + " must be a short unit label.");
      }
      return value.trim();
    }

    function integer(value, field, min, max) {
      if (!Number.isSafeInteger(value) || value < min || value > max) {
        fail("invalid-argument", field + " is outside the supported range.");
      }
      return value;
    }

    const baseUnit = unit(data.baseUnit, "Base unit");
    const bulkUnit = unit(data.bulkUnit, "Bulk unit");
    const unitsPerBulk = integer(
      data.unitsPerBulk, "Units per bulk", 1, 1000000
    );

    if (baseUnit.toLowerCase() === bulkUnit.toLowerCase() &&
        unitsPerBulk !== 1) {
      fail("invalid-argument",
        "Identical base and bulk labels require a conversion of one.");
    }

    if (data.confirmUncounted !== true) {
      fail("failed-precondition",
        "Confirm that this product has not had its opening stock verified.");
    }

    return {
      productId,
      baseUnit,
      bulkUnit,
      unitsPerBulk,
      basePricePesewas: integer(
        data.basePricePesewas, "Base price", 1, 1000000000
      ),
      bulkPricePesewas: integer(
        data.bulkPricePesewas, "Bulk price", 1, 1000000000
      ),
      expectedRevision: integer(
        data.expectedRevision, "Revision", 0, 1000000000
      )
    };
  }

  async function configureProduct(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in before setting up a product.");

    const input = validateSetup(request.data);

    return db.runTransaction(async (transaction) => {
      const profileRef = db.collection("users").doc(uid);
      const productRef = db.collection("products").doc(input.productId);
      const setupRef = db.collection("openingStockProducts").doc(input.productId);
      const modeRef = db.collection("settings").doc("secureSales");
      const taxRef = db.collection("settings").doc("tax");

      const [profileDoc, productDoc, setupDoc, modeDoc, taxDoc] =
        await Promise.all([
          transaction.get(profileRef),
          transaction.get(productRef),
          transaction.get(setupRef),
          transaction.get(modeRef),
          transaction.get(taxRef)
        ]);

      const profile = profileDoc.exists ? profileDoc.data() : null;
      if (!profile || profile.role !== "admin" ||
          profile.active === false || profile.isActive === false) {
        fail("permission-denied",
          "Only an active Admin can enable opening-stock sales.");
      }

      if (modeDoc.exists && modeDoc.data().enabled === true) {
        fail("failed-precondition",
          "Opening-stock setup is unavailable in secure inventory mode.");
      }

      if (!taxDoc.exists) {
        fail("failed-precondition",
          "Save the business tax settings before enabling opening-stock sales.");
      }

      if (!productDoc.exists) fail("not-found", "Product not found.");
      const product = productDoc.data();

      if (Number(product.inventorySchemaVersion) === 2) {
        fail("failed-precondition",
          "Authoritative v2 products cannot use legacy opening-stock setup.");
      }
      if (product.active === false || product.isActive === false) {
        fail("failed-precondition", "This product is inactive.");
      }
      if (product.quantity !== undefined &&
          (!Number.isSafeInteger(product.quantity) || product.quantity !== 0)) {
        fail("failed-precondition",
          "This setup cannot replace an existing recorded stock balance.");
      }
      if (product.sellableQuantity !== undefined &&
          product.sellableQuantity !== 0) {
        fail("failed-precondition",
          "This product already has a recorded sellable balance.");
      }

      const current = setupDoc.exists ? setupDoc.data() : null;
      if (current && current.status !== "unverified") {
        fail("failed-precondition",
          "A counting or verified product cannot be reconfigured here.");
      }

      const revision = current ? current.revision : 0;
      if (!Number.isSafeInteger(revision) ||
          revision !== input.expectedRevision) {
        fail("aborted", "Product setup changed. Reload before saving.");
      }

      // Packaging and prices must remain stable once the first sale is recorded.
      if (current && current.salesStarted === true) {
        fail("failed-precondition",
          "Selling details are locked after the first opening-stock sale.");
      }

      const setup = {
        productId: input.productId,
        baseUnit: input.baseUnit,
        bulkUnit: input.bulkUnit,
        unitsPerBulk: input.unitsPerBulk,
        basePricePesewas: input.basePricePesewas,
        bulkPricePesewas: input.bulkPricePesewas,
        status: "unverified",
        revision: revision + 1,
        salesStarted: false,
        approvedBy: uid
      };

      transaction.set(setupRef, {
        ...setup,
        createdBy: current?.createdBy || uid,
        createdAt: current?.createdAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      });

      // Return only concrete values, never unresolved timestamp sentinels.
      return { setup };
    });
  }

  return { configureProduct };
}

module.exports = { createOpeningStockService };
