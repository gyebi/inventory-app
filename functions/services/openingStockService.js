"use strict";

const crypto = require("node:crypto");
const { createSaleTaxHelpers } = require("./saleTaxHelpers");

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
      if (!Number.isSafeInteger(product.quantity) || product.quantity !== 0) {
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


  function safeMultiply(a, b, field) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) ||
        a < 0 || b < 0 ||
        (a !== 0 && b > Math.floor(Number.MAX_SAFE_INTEGER / a))) {
      fail("failed-precondition", field + " exceeds supported precision.");
    }
    return a * b;
  }

  function safeAdd(a, b, field) {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) ||
        a < 0 || b < 0 || b > Number.MAX_SAFE_INTEGER - a) {
      fail("failed-precondition", field + " exceeds supported precision.");
    }
    return a + b;
  }

  const { normalizedTax, calculateTax, legacyTax } =
    createSaleTaxHelpers({ fail, add: safeAdd, multiply: safeMultiply });

  async function quoteSale(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in before reviewing a sale.");

    const data = request.data;
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some((key) =>
          !["items", "paymentMethod"].includes(key))) {
      fail("invalid-argument", "Invalid opening-stock quote request.");
    }
    if (!Array.isArray(data.items) ||
        data.items.length < 1 || data.items.length > 20) {
      fail("invalid-argument", "A sale must contain 1 to 20 lines.");
    }

    const paymentMethod = data.paymentMethod;
    if (!["cash", "mobile_money", "card"].includes(paymentMethod)) {
      fail("invalid-argument", "Choose a supported payment method.");
    }

    const seen = new Set();
    const inputs = data.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) ||
          Object.keys(item).some((key) =>
            !["productId", "quantity", "unit"].includes(key))) {
        fail("invalid-argument", "Invalid sale line.");
      }
      if (typeof item.productId !== "string" ||
          !item.productId || item.productId.length > 128 ||
          item.productId.includes("/") ||
          item.productId !== item.productId.trim()) {
        fail("invalid-argument", "Invalid product ID.");
      }
      if (!Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 || item.quantity > 1000000 ||
          !["base", "bulk"].includes(item.unit)) {
        fail("invalid-argument", "Invalid sale quantity or unit.");
      }
      const key = JSON.stringify([item.productId, item.unit]);
      if (seen.has(key)) fail("invalid-argument", "Combine duplicate sale lines.");
      seen.add(key);
      return {
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit
      };
    });

    return db.runTransaction(async (transaction) => {
      const [profileDoc, modeDoc, taxDoc] = await Promise.all([
        transaction.get(db.collection("users").doc(uid)),
        transaction.get(db.collection("settings").doc("secureSales")),
        transaction.get(db.collection("settings").doc("tax"))
      ]);

      const profile = profileDoc.exists ? profileDoc.data() : null;
      if (!profile || !["admin", "sales"].includes(profile.role) ||
          profile.active === false || profile.isActive === false) {
        fail("permission-denied", "This staff account cannot create sales.");
      }
      if (modeDoc.exists && modeDoc.data().enabled === true) {
        fail("failed-precondition",
          "Opening-stock checkout is unavailable in secure inventory mode.");
      }
      if (!taxDoc.exists) {
        fail("failed-precondition", "Business tax settings must be saved first.");
      }

      const setups = new Map();
      for (const productId of new Set(inputs.map((item) => item.productId))) {
        const [productDoc, setupDoc] = await Promise.all([
          transaction.get(db.collection("products").doc(productId)),
          transaction.get(db.collection("openingStockProducts").doc(productId))
        ]);
        if (!productDoc.exists || !setupDoc.exists) {
          fail("failed-precondition",
            "An Admin must confirm this product's opening-stock setup first.");
        }

        const product = productDoc.data();
        const setup = setupDoc.data();

        if (product.active === false || product.isActive === false ||
            Number(product.inventorySchemaVersion) === 2 ||
            setup.status !== "unverified") {
          fail("failed-precondition",
            "This product is not available for opening-stock sales.");
        }
        if (setup.productId !== productId) {
          fail("failed-precondition", "Product setup reference is invalid.");
        }
        if (!Number.isSafeInteger(product.quantity) || product.quantity !== 0 ||
            (product.sellableQuantity !== undefined &&
             product.sellableQuantity !== 0)) {
          fail("failed-precondition",
            "Recorded stock changed. Opening-stock setup needs review.");
        }

        // Revalidate persisted packaging and prices, not browser-supplied values.
        const approved = validateSetup({
          productId,
          baseUnit: setup.baseUnit,
          bulkUnit: setup.bulkUnit,
          unitsPerBulk: setup.unitsPerBulk,
          basePricePesewas: setup.basePricePesewas,
          bulkPricePesewas: setup.bulkPricePesewas,
          expectedRevision: setup.revision,
          confirmUncounted: true
        });
        setups.set(productId, { product, approved });
      }

      let subtotalPesewas = 0;
      const items = inputs.map((input) => {
        const { product, approved } = setups.get(input.productId);
        const unitPricePesewas = input.unit === "base"
          ? approved.basePricePesewas : approved.bulkPricePesewas;
        const lineTotalPesewas = safeMultiply(
          unitPricePesewas, input.quantity, "Line total"
        );
        subtotalPesewas = safeAdd(
          subtotalPesewas, lineTotalPesewas, "Subtotal"
        );
        const baseQuantity = safeMultiply(
          input.quantity,
          input.unit === "bulk" ? approved.unitsPerBulk : 1,
          "Base quantity"
        );
        const label = input.unit === "base"
          ? approved.baseUnit : approved.bulkUnit;

        return {
          productId: input.productId,
          name: String(product.name || input.productId),
          quantity: input.quantity,
          saleUnit: input.unit,
          unit: label,
          unitLabel: label,
          unitsPerBulk: approved.unitsPerBulk,
          setupRevision: approved.expectedRevision,
          baseQuantity,
          actualQtySold: baseQuantity,
          unitPricePesewas,
          lineTotalPesewas,
          unitPrice: unitPricePesewas / 100,
          total: lineTotalPesewas / 100,
          batchAllocations: [],
          costStatus: "unknown",
          stockEffect: "unverified"
        };
      });

      const tax = normalizedTax(taxDoc.data());
      const calculatedTax = calculateTax(subtotalPesewas, tax);
      const quoteFingerprint = crypto.createHash("sha256")
        .update(JSON.stringify({ paymentMethod, items, calculatedTax }))
        .digest("hex");

      return {
        openingStock: true,
        quoteFingerprint,
        sale: {
          currency: "GHS",
          paymentMethod,
          items,
          subtotalPesewas,
          subtotalAmount: subtotalPesewas / 100,
          taxBreakdown: legacyTax(calculatedTax),
          taxSettingsSnapshot: tax,
          totalAmountPesewas: calculatedTax.totalAmountPesewas,
          totalAmount: calculatedTax.totalAmountPesewas / 100,
          costStatus: "unknown",
          profit: null,
          stockEffect: "unverified"
        }
      };
    });
  }

  function requestKey(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(value)) {
      fail("invalid-argument", "idempotencyKey must be 16-128 URL-safe characters and be retained until the sale outcome is known.");
    }
    return value;
  }

  function submitInput(data) {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some((key) => !["idempotencyKey", "items", "paymentMethod", "expectedQuoteFingerprint"].includes(key))) {
      fail("invalid-argument", "Invalid opening-stock sale request.");
    }
    const idempotencyKey = requestKey(data.idempotencyKey);
    if (typeof data.expectedQuoteFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.expectedQuoteFingerprint)) {
      fail("failed-precondition", "Review the current opening-stock quote before completing this sale.");
    }
    const quoteData = { items: data.items, paymentMethod: data.paymentMethod };
    // Quote validation is deliberately shared with submissions: the browser
    // never supplies prices, tax, labels, or conversions.
    return { idempotencyKey, expectedQuoteFingerprint: data.expectedQuoteFingerprint, quoteData };
  }

  function actor(profile, uid) {
    return {
      uid,
      fullName: profile.fullName || profile.displayName || profile.username || uid,
      username: profile.username || "",
      role: profile.role
    };
  }

  function hash(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  function quoteFingerprint(paymentMethod, items, calculatedTax) {
    return hash(JSON.stringify({ paymentMethod, items, calculatedTax }));
  }

  async function assertOpeningSaleStillCurrent(transaction, uid, quote) {
    const [profileDoc, modeDoc, taxDoc] = await Promise.all([
      transaction.get(db.collection("users").doc(uid)),
      transaction.get(db.collection("settings").doc("secureSales")),
      transaction.get(db.collection("settings").doc("tax"))
    ]);
    const profile = profileDoc.exists ? profileDoc.data() : null;
    if (!profile || !["admin", "sales"].includes(profile.role) || profile.active === false || profile.isActive === false) {
      fail("permission-denied", "This staff account cannot create sales.");
    }
    if (modeDoc.exists && modeDoc.data().enabled === true) {
      fail("failed-precondition", "Opening-stock checkout is unavailable in secure inventory mode.");
    }
    if (!taxDoc.exists) fail("failed-precondition", "Business tax settings must be saved first.");

    const productIds = [...new Set(quote.sale.items.map((item) => item.productId))];
    for (const productId of productIds) {
      const [productDoc, setupDoc] = await Promise.all([
        transaction.get(db.collection("products").doc(productId)),
        transaction.get(db.collection("openingStockProducts").doc(productId))
      ]);
      const product = productDoc.exists ? productDoc.data() : null;
      const setup = setupDoc.exists ? setupDoc.data() : null;
      const quoted = quote.sale.items.filter((item) => item.productId === productId);
      if (!product || !setup || product.active === false || product.isActive === false ||
          Number(product.inventorySchemaVersion) === 2 || setup.status !== "unverified" ||
          !Number.isSafeInteger(product.quantity) || product.quantity !== 0 ||
          (product.sellableQuantity !== undefined && product.sellableQuantity !== 0) ||
          quoted.some((item) => item.setupRevision !== setup.revision ||
            item.unitsPerBulk !== setup.unitsPerBulk ||
            item.unitLabel !== (item.saleUnit === "base" ? setup.baseUnit : setup.bulkUnit) ||
            item.unitPricePesewas !== (item.saleUnit === "base" ? setup.basePricePesewas : setup.bulkPricePesewas))) {
        fail("failed-precondition", "Prices, packaging, stock status, or tax settings changed before this sale was submitted. Review the updated quote.");
      }
    }

    const tax = normalizedTax(taxDoc.data());
    const calculatedTax = calculateTax(quote.sale.subtotalPesewas, tax);
    if (quoteFingerprint(quote.sale.paymentMethod, quote.sale.items, calculatedTax) !== quote.quoteFingerprint) {
      fail("failed-precondition", "Prices, packaging, stock status, or tax settings changed before this sale was submitted. Review the updated quote.");
    }
    return { profile, calculatedTax };
  }

  async function submitSale(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in before completing a sale.");
    const input = submitInput(request.data);

    const fingerprint = hash(JSON.stringify({ ...input.quoteData, expectedQuoteFingerprint: input.expectedQuoteFingerprint }));
    const requestRef = db.collection("openingStockSaleRequests").doc(hash(`${uid}\u0000${input.idempotencyKey}`));
    const saleId = `OSL-${hash(`${uid}\u0000${input.idempotencyKey}`).slice(0, 24)}`;

    // Resolve an unknown outcome before generating a fresh quote. This keeps a
    // conflicting retry from being misreported as a price change.
    const recovered = await db.runTransaction(async (transaction) => {
      const [profileDoc, existing] = await Promise.all([
        transaction.get(db.collection("users").doc(uid)), transaction.get(requestRef)
      ]);
      const profile = profileDoc.exists ? profileDoc.data() : null;
      if (!profile || !["admin", "sales"].includes(profile.role) || profile.active === false || profile.isActive === false) {
        fail("permission-denied", "This staff account cannot create sales.");
      }
      if (!existing.exists) return null;
      const saved = existing.data() || {};
      if (saved.uid !== uid || saved.fingerprint !== fingerprint || !saved.response) {
        fail("already-exists", "This idempotency key was already used with a different sale.");
      }
      return saved.response;
    });
    if (recovered) return recovered;

    // The initial quote is read-only. The second transaction below repeats the
    // mutable checks and is the cutover point that serializes sale/count races.
    const quote = await quoteSale({ auth: request.auth, data: input.quoteData });
    if (quote.quoteFingerprint !== input.expectedQuoteFingerprint) {
      fail("failed-precondition", "Prices, packaging, stock status, or tax settings changed before this sale was submitted. Review the updated quote.");
    }

    return db.runTransaction(async (transaction) => {
      const existing = await transaction.get(requestRef);
      if (existing.exists) {
        const saved = existing.data() || {};
        if (saved.uid !== uid || saved.fingerprint !== fingerprint || !saved.response) {
          fail("already-exists", "This idempotency key was already used with a different sale.");
        }
        return saved.response;
      }

      const { profile, calculatedTax } = await assertOpeningSaleStillCurrent(transaction, uid, quote);
      const createdBy = actor(profile, uid);
      const committedAt = new Date().toISOString();
      const items = quote.sale.items.map((item) => ({ ...item }));
      const sale = {
        id: saleId,
        schemaVersion: 1,
        inventorySchemaVersion: 1,
        openingStock: true,
        stockEffect: "unverified",
        costStatus: "unknown",
        profit: null,
        currency: "GHS",
        paymentMethod: quote.sale.paymentMethod,
        createdBy,
        user: createdBy.fullName,
        items,
        productId: items.length === 1 ? items[0].productId : null,
        product: items.length === 1 ? items[0].name : "Multiple Items",
        qty: items.length === 1 ? items[0].quantity : items.length,
        saleUnit: items.length === 1 ? items[0].unitLabel : "items",
        saleUnitType: items.length === 1 ? items[0].saleUnit : "mixed",
        actualQtySold: items.reduce((total, item) => safeAdd(total, item.baseQuantity, "sale quantity"), 0),
        subtotalPesewas: quote.sale.subtotalPesewas,
        subtotalAmount: quote.sale.subtotalAmount,
        taxBreakdown: legacyTax(calculatedTax),
        taxSettingsSnapshot: calculatedTax,
        totalAmountPesewas: calculatedTax.totalAmountPesewas,
        totalAmount: calculatedTax.totalAmountPesewas / 100,
        quoteFingerprint: quote.quoteFingerprint,
        createdAt: committedAt,
        committedAt,
        syncStatus: "synced",
        cloudSyncedAt: committedAt
      };
      const response = { committed: true, saleId, sale };
      transaction.set(db.collection("sales").doc(saleId), { ...sale, serverCreatedAt: FieldValue.serverTimestamp() });
      for (const productId of new Set(items.map((item) => item.productId))) {
        transaction.update(db.collection("openingStockProducts").doc(productId), {
          salesStarted: true,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: createdBy
        });
      }
      transaction.set(requestRef, {
        uid,
        fingerprint,
        response,
        saleId,
        createdAt: committedAt,
        serverCreatedAt: FieldValue.serverTimestamp()
      });
      return response;
    });
  }

  function countInput(data, { allowZero = false } = {}) {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.keys(data).some((key) => !["productId", "expectedRevision", "batches"].includes(key))) {
      fail("invalid-argument", "Invalid opening-stock count request.");
    }
    const productId = String(data.productId || "").trim();
    if (!productId || productId.length > 128 || productId.includes("/")) fail("invalid-argument", "A valid product ID is required.");
    if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 1) fail("invalid-argument", "Reload the opening-stock setup before counting.");
    if (!allowZero && data.batches !== undefined) fail("invalid-argument", "Batches are recorded when confirming the count.");
    const batches = data.batches === undefined ? null : data.batches;
    if (batches !== null && (!Array.isArray(batches) || batches.length > 50)) fail("invalid-argument", "Use up to 50 counted batches.");
    const seen = new Set();
    const normalizedBatches = batches === null ? null : batches.map((batch, index) => {
      if (!batch || typeof batch !== "object" || Array.isArray(batch) || Object.keys(batch).some((key) => !["reference", "baseQuantity"].includes(key))) fail("invalid-argument", "Each counted batch needs only a reference and whole base quantity.");
      const reference = String(batch.reference || "").trim();
      if (!reference || reference.length > 120 || /[\x00-\x1f\x7f]/.test(reference) || seen.has(reference)) fail("invalid-argument", "Each counted batch needs a unique short reference.");
      seen.add(reference);
      if (!Number.isSafeInteger(batch.baseQuantity) || batch.baseQuantity < 1 || batch.baseQuantity > 1000000000) fail("invalid-argument", "Each counted batch quantity must be a positive whole base quantity.");
      return { reference, baseQuantity: batch.baseQuantity, order: index + 1 };
    });
    return { productId, expectedRevision: data.expectedRevision, batches: normalizedBatches };
  }

  async function startCount(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in before starting an opening-stock count.");
    const input = countInput(request.data);
    return db.runTransaction(async (transaction) => {
      const [profileDoc, modeDoc, productDoc, setupDoc, countDoc] = await Promise.all([
        transaction.get(db.collection("users").doc(uid)), transaction.get(db.collection("settings").doc("secureSales")),
        transaction.get(db.collection("products").doc(input.productId)), transaction.get(db.collection("openingStockProducts").doc(input.productId)),
        transaction.get(db.collection("openingStockCounts").doc(input.productId))
      ]);
      const profile = profileDoc.exists ? profileDoc.data() : null;
      const product = productDoc.exists ? productDoc.data() : null;
      const setup = setupDoc.exists ? setupDoc.data() : null;
      if (!profile || profile.role !== "admin" || profile.active === false || profile.isActive === false) fail("permission-denied", "Only an active Admin can start an opening-stock count.");
      if (modeDoc.exists && modeDoc.data().enabled === true) fail("failed-precondition", "Opening-stock counting is unavailable in secure inventory mode.");
      if (!product || !setup || Number(product.inventorySchemaVersion) === 2 || setup.status !== "unverified" || setup.revision !== input.expectedRevision || !Number.isSafeInteger(product.quantity) || product.quantity !== 0 || Number(product.sellableQuantity || 0) !== 0) fail("failed-precondition", "Reload the eligible product before starting its opening-stock count.");
      if (countDoc.exists && countDoc.data()?.status === "counting") fail("failed-precondition", "An opening-stock count is already active for this product.");
      const startedBy = actor(profile, uid);
      const count = { productId: input.productId, status: "counting", setupRevision: setup.revision, baseUnit: setup.baseUnit, bulkUnit: setup.bulkUnit, unitsPerBulk: setup.unitsPerBulk, startedBy, startedAt: new Date().toISOString(), revision: 1 };
      transaction.set(db.collection("openingStockCounts").doc(input.productId), { ...count, serverStartedAt: FieldValue.serverTimestamp() });
      transaction.update(db.collection("openingStockProducts").doc(input.productId), { status: "counting", revision: setup.revision + 1, countingBy: startedBy, countingAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return { committed: true, count: { ...count, setupRevision: setup.revision + 1 } };
    });
  }

  async function cancelCount(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in before cancelling an opening-stock count.");
    const input = countInput(request.data);
    return db.runTransaction(async (transaction) => {
      const [profileDoc, setupDoc, countDoc] = await Promise.all([transaction.get(db.collection("users").doc(uid)), transaction.get(db.collection("openingStockProducts").doc(input.productId)), transaction.get(db.collection("openingStockCounts").doc(input.productId))]);
      const profile = profileDoc.exists ? profileDoc.data() : null; const setup = setupDoc.exists ? setupDoc.data() : null; const count = countDoc.exists ? countDoc.data() : null;
      if (!profile || profile.role !== "admin" || profile.active === false || profile.isActive === false) fail("permission-denied", "Only an active Admin can cancel an opening-stock count.");
      if (!setup || !count || setup.status !== "counting" || count.status !== "counting" || setup.revision !== input.expectedRevision) fail("aborted", "This count changed. Reload before cancelling.");
      const cancelledBy = actor(profile, uid);
      transaction.update(countDoc.ref, { status: "cancelled", cancelledBy, cancelledAt: FieldValue.serverTimestamp(), revision: Number(count.revision || 1) + 1 });
      transaction.update(setupDoc.ref, { status: "unverified", revision: setup.revision + 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: cancelledBy });
      return { committed: true, status: "cancelled" };
    });
  }

  async function confirmCount(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "Sign in before confirming an opening-stock count.");
    const input = countInput(request.data, { allowZero: true });
    if (input.batches === null) fail("invalid-argument", "Enter counted batches. Use an empty list to confirm explicit zero stock.");
    return db.runTransaction(async (transaction) => {
      const [profileDoc, productDoc, setupDoc, countDoc, balanceDoc] = await Promise.all([
        transaction.get(db.collection("users").doc(uid)), transaction.get(db.collection("products").doc(input.productId)), transaction.get(db.collection("openingStockProducts").doc(input.productId)), transaction.get(db.collection("openingStockCounts").doc(input.productId)), transaction.get(db.collection("openingStockBalances").doc(input.productId))
      ]);
      const profile = profileDoc.exists ? profileDoc.data() : null; const product = productDoc.exists ? productDoc.data() : null; const setup = setupDoc.exists ? setupDoc.data() : null; const count = countDoc.exists ? countDoc.data() : null;
      if (!profile || profile.role !== "admin" || profile.active === false || profile.isActive === false) fail("permission-denied", "Only an active Admin can confirm an opening-stock count.");
      if (!product || !setup || !count || balanceDoc.exists || setup.status !== "counting" || count.status !== "counting" || setup.revision !== input.expectedRevision || !Number.isSafeInteger(product.quantity) || product.quantity !== 0 || Number(product.sellableQuantity || 0) !== 0 || count.setupRevision !== setup.revision - 1) fail("aborted", "This count or product changed. Reload before confirming.");
      // The approved opening prices become the normal legacy product prices at
      // activation. Revalidate the persisted approval so a malformed setup can
      // never activate stock with a zero-price checkout path.
      const approved = validateSetup({
        productId: setup.productId,
        baseUnit: setup.baseUnit,
        bulkUnit: setup.bulkUnit,
        unitsPerBulk: setup.unitsPerBulk,
        basePricePesewas: setup.basePricePesewas,
        bulkPricePesewas: setup.bulkPricePesewas,
        expectedRevision: setup.revision,
        confirmUncounted: true
      });
      const totalBaseQuantity = input.batches.reduce((total, batch) => safeAdd(total, batch.baseQuantity, "opening balance"), 0);
      const confirmedBy = actor(profile, uid);
      const batches = input.batches.map((batch) => ({ id: `OB-${hash(`${input.productId}\u0000${batch.reference}`).slice(0, 24)}`, reference: batch.reference, baseQuantity: batch.baseQuantity, remainingBaseQuantity: batch.baseQuantity, inventoryStatus: "active", expiryDate: null, costStatus: "unknown" }));
      const balance = { productId: input.productId, schemaVersion: 1, inventoryMode: "legacy", totalBaseQuantity, remainingBaseQuantity: totalBaseQuantity, baseUnit: count.baseUnit, bulkUnit: count.bulkUnit, unitsPerBulk: count.unitsPerBulk, costStatus: "unknown", batches, confirmedBy, confirmedAt: new Date().toISOString() };
      transaction.set(balanceDoc.ref, { ...balance, serverConfirmedAt: FieldValue.serverTimestamp() });
      transaction.update(productDoc.ref, {
        quantity: totalBaseQuantity,
        sellingPrice: approved.basePricePesewas / 100,
        bulkSellingPrice: approved.bulkPricePesewas / 100,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: confirmedBy.uid
      });
      transaction.update(setupDoc.ref, { status: "verified", revision: setup.revision + 1, verifiedBy: confirmedBy, verifiedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      transaction.update(countDoc.ref, { status: "confirmed", confirmedBy, confirmedAt: FieldValue.serverTimestamp(), revision: Number(count.revision || 1) + 1, totalBaseQuantity });
      return { committed: true, balance };
    });
  }

  return { configureProduct, quoteSale, submitSale, startCount, cancelCount, confirmCount };

}

module.exports = { createOpeningStockService };
