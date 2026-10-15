"use strict";

const crypto = require("node:crypto");

const SALES_ROLES = new Set(["admin", "sales"]);
const PAYMENT_METHODS = new Set(["cash", "mobile_money", "card", "credit", "other"]);
const TAX_MODES = new Set(["standard", "zeroRated", "exempt"]);
const DEFAULT_TAX_SETTINGS = {
  enabled: true,
  vatRate: 15,
  nhilRate: 2.5,
  getfundRate: 2.5,
  withholdingVatRate: 7,
  effectiveDate: null,
  taxMode: "standard"
};

function createSecureSalesService({ db, FieldValue, HttpsError }) {
  function fail(code, message) {
    throw new HttpsError(code, message);
  }

  function asObject(value, fieldName) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail("invalid-argument", `${fieldName} must be an object.`);
    }

    return value;
  }

  function rejectUnknownFields(value, allowedFields, fieldName) {
    Object.keys(value).forEach((field) => {
      if (!allowedFields.has(field)) {
        fail("invalid-argument", `${fieldName}.${field} is not supported.`);
      }
    });
  }

  function normalizeIdempotencyKey(value) {
    const key = String(value || "").trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(key)) {
      fail("invalid-argument", "idempotencyKey must be 16-128 URL-safe characters and be persisted by the client before submission.");
    }

    return key;
  }

  function normalizeProductId(value) {
    const productId = String(value || "").trim();

    if (!productId || productId.length > 128 || productId.includes("/")) {
      fail("invalid-argument", "Each item must contain a valid productId.");
    }

    return productId;
  }

  function normalizeQuantity(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) {
      fail("invalid-argument", "Each item quantity must be a whole number from 1 to 1,000,000.");
    }

    return value;
  }

  function normalizeUnit(value) {
    const unit = String(value || "").trim().toLowerCase();

    if (unit !== "base" && unit !== "bulk") {
      fail("invalid-argument", "Each item unit must be either base or bulk.");
    }

    return unit;
  }

  function normalizePaymentMethod(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const paymentMethod = String(value).trim().toLowerCase();

    if (!PAYMENT_METHODS.has(paymentMethod)) {
      fail("invalid-argument", "paymentMethod is not supported.");
    }

    return paymentMethod;
  }

  function normalizeRequest(data) {
    const request = asObject(data, "request");
    rejectUnknownFields(request, new Set(["idempotencyKey", "items", "paymentMethod"]), "request");

    if (!Array.isArray(request.items) || request.items.length === 0 || request.items.length > 50) {
      fail("invalid-argument", "items must contain between 1 and 50 items.");
    }

    const productIds = new Set();
    const items = request.items.map((rawItem, index) => {
      const item = asObject(rawItem, `items[${index}]`);
      rejectUnknownFields(item, new Set(["productId", "quantity", "unit"]), `items[${index}]`);
      const productId = normalizeProductId(item.productId);

      if (productIds.has(productId)) {
        fail("invalid-argument", "Each product may appear only once in a sale request.");
      }
      productIds.add(productId);

      return {
        productId,
        quantity: normalizeQuantity(item.quantity),
        unit: normalizeUnit(item.unit)
      };
    });

    return {
      idempotencyKey: normalizeIdempotencyKey(request.idempotencyKey),
      items,
      paymentMethod: normalizePaymentMethod(request.paymentMethod)
    };
  }

  function hash(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  function toPesewas(value, fieldName, { allowZero = false } = {}) {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
      fail("failed-precondition", `${fieldName} must be a valid ${allowZero ? "non-negative" : "positive"} Ghana cedi amount.`);
    }

    const pesewas = Math.round(amount * 100);

    if (!Number.isSafeInteger(pesewas) || (!allowZero && pesewas < 1)) {
      fail("failed-precondition", `${fieldName} cannot be represented safely in pesewas.`);
    }

    return pesewas;
  }

  function rateToBasisPoints(value, fieldName) {
    const rate = Number(value);

    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      fail("failed-precondition", `${fieldName} must be a percentage from 0 to 100.`);
    }

    return Math.round(rate * 100);
  }

  function calculatePercentagePesewas(amountPesewas, basisPoints) {
    return Math.round((amountPesewas * basisPoints) / 10000);
  }

  function normalizeTaxSettings(data = {}) {
    const settings = {
      ...DEFAULT_TAX_SETTINGS,
      ...data
    };
    const taxMode = String(settings.taxMode || DEFAULT_TAX_SETTINGS.taxMode);

    if (!TAX_MODES.has(taxMode)) {
      fail("failed-precondition", "settings/tax contains an unsupported taxMode.");
    }

    return {
      enabled: settings.enabled !== false && taxMode !== "exempt",
      taxMode,
      effectiveDate: settings.effectiveDate || null,
      vatRateBasisPoints: rateToBasisPoints(settings.vatRate, "settings/tax.vatRate"),
      nhilRateBasisPoints: rateToBasisPoints(settings.nhilRate, "settings/tax.nhilRate"),
      getfundRateBasisPoints: rateToBasisPoints(settings.getfundRate, "settings/tax.getfundRate"),
      withholdingVatRateBasisPoints: rateToBasisPoints(settings.withholdingVatRate, "settings/tax.withholdingVatRate")
    };
  }

  function calculateTax(subtotalPesewas, taxSettings) {
    const chargeable = taxSettings.enabled && taxSettings.taxMode === "standard";
    const vatAmountPesewas = chargeable
      ? calculatePercentagePesewas(subtotalPesewas, taxSettings.vatRateBasisPoints)
      : 0;
    const nhilAmountPesewas = chargeable
      ? calculatePercentagePesewas(subtotalPesewas, taxSettings.nhilRateBasisPoints)
      : 0;
    const getfundAmountPesewas = chargeable
      ? calculatePercentagePesewas(subtotalPesewas, taxSettings.getfundRateBasisPoints)
      : 0;
    const withholdingVatAmountPesewas = chargeable
      ? calculatePercentagePesewas(subtotalPesewas, taxSettings.withholdingVatRateBasisPoints)
      : 0;
    const taxAmountPesewas = vatAmountPesewas + nhilAmountPesewas + getfundAmountPesewas;

    return {
      enabled: chargeable,
      taxMode: taxSettings.taxMode,
      effectiveDate: taxSettings.effectiveDate,
      vatRateBasisPoints: taxSettings.vatRateBasisPoints,
      nhilRateBasisPoints: taxSettings.nhilRateBasisPoints,
      getfundRateBasisPoints: taxSettings.getfundRateBasisPoints,
      withholdingVatRateBasisPoints: taxSettings.withholdingVatRateBasisPoints,
      vatAmountPesewas,
      nhilAmountPesewas,
      getfundAmountPesewas,
      withholdingVatAmountPesewas,
      taxAmountPesewas,
      totalAmountPesewas: subtotalPesewas + taxAmountPesewas
    };
  }

  function getProductPricing(product, unit) {
    const unitsPerBulk = Number(product.unitsPerBulk || 1);

    if (!Number.isSafeInteger(unitsPerBulk) || unitsPerBulk < 1) {
      fail("failed-precondition", "Product unitsPerBulk must be a positive whole number.");
    }

    const basePricePesewas = product.sellingPrice === undefined || product.sellingPrice === null
      ? null
      : toPesewas(product.sellingPrice, "Product sellingPrice");
    const bulkPricePesewas = product.bulkSellingPrice === undefined || product.bulkSellingPrice === null
      ? null
      : toPesewas(product.bulkSellingPrice, "Product bulkSellingPrice");

    if (unit === "base" && basePricePesewas === null) {
      fail("failed-precondition", "This product has no canonical product-level sellingPrice. Batch-price policy approval is required before it can be sold by this command.");
    }

    if (unit === "bulk" && bulkPricePesewas === null && basePricePesewas === null) {
      fail("failed-precondition", "This product has no canonical product-level selling price. Batch-price policy approval is required before it can be sold by this command.");
    }

    return {
      unitsPerBulk,
      unitPricePesewas: unit === "bulk"
        ? (bulkPricePesewas === null ? basePricePesewas * unitsPerBulk : bulkPricePesewas)
        : basePricePesewas
    };
  }

  function createSaleResponse({ saleId, committedAt, items, subtotalPesewas, taxBreakdown, paymentMethod, createdBy }) {
    return {
      saleId,
      committed: true,
      committedAt,
      currency: "GHS",
      paymentMethod,
      createdBy,
      items,
      subtotalPesewas,
      taxBreakdown,
      totalAmountPesewas: taxBreakdown.totalAmountPesewas
    };
  }

  async function submitSecureSale(request) {
    if (!request.auth?.uid) {
      fail("unauthenticated", "You must be signed in to submit a sale.");
    }

    const uid = request.auth.uid;
    const payload = normalizeRequest(request.data);
    const requestFingerprint = hash(JSON.stringify(payload));
    const requestHash = hash(`${uid}\u0000${payload.idempotencyKey}`);
    const requestRef = db.collection("saleRequests").doc(requestHash);
    const saleRef = db.collection("sales").doc(`SEC-${requestHash.slice(0, 32)}`);
    const profileRef = db.collection("users").doc(uid);
    const taxRef = db.collection("settings").doc("tax");

    return db.runTransaction(async (transaction) => {
      const existingRequest = await transaction.get(requestRef);

      if (existingRequest.exists) {
        const existing = existingRequest.data() || {};

        if (existing.uid !== uid || existing.requestFingerprint !== requestFingerprint || !existing.response) {
          fail("already-exists", "This idempotencyKey has already been used for a different sale request.");
        }

        return existing.response;
      }

      const [profileSnapshot, taxSnapshot] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(taxRef)
      ]);

      if (!profileSnapshot.exists) {
        fail("permission-denied", "Caller staff profile was not found.");
      }

      const profile = profileSnapshot.data() || {};

      if (profile.active === false || profile.isActive === false) {
        fail("permission-denied", "This staff profile is inactive.");
      }

      if (!SALES_ROLES.has(profile.role)) {
        fail("permission-denied", "This staff role cannot create sales.");
      }

      const taxSettings = normalizeTaxSettings(taxSnapshot.exists ? taxSnapshot.data() || {} : {});
      const productSnapshots = [];

      for (const item of payload.items) {
        const productRef = db.collection("products").doc(item.productId);
        const productSnapshot = await transaction.get(productRef);

        if (!productSnapshot.exists) {
          fail("not-found", `Product ${item.productId} was not found.`);
        }

        productSnapshots.push({ item, productRef, product: productSnapshot.data() || {} });
      }

      const items = [];
      let subtotalPesewas = 0;

      for (const { item, productRef, product } of productSnapshots) {
        if (product.active === false || product.isActive === false) {
          fail("failed-precondition", `Product ${item.productId} is inactive.`);
        }

        const currentQuantity = Number(product.quantity);

        if (!Number.isSafeInteger(currentQuantity) || currentQuantity < 0) {
          fail("failed-precondition", `Product ${item.productId} has an invalid authoritative quantity.`);
        }

        const pricing = getProductPricing(product, item.unit);
        const baseQuantity = item.unit === "bulk" ? item.quantity * pricing.unitsPerBulk : item.quantity;

        if (!Number.isSafeInteger(baseQuantity) || baseQuantity < 1) {
          fail("invalid-argument", `Quantity for product ${item.productId} exceeds supported limits.`);
        }

        if (currentQuantity < baseQuantity) {
          fail("failed-precondition", `Insufficient stock for product ${item.productId}.`);
        }

        const lineTotalPesewas = pricing.unitPricePesewas * item.quantity;

        if (!Number.isSafeInteger(lineTotalPesewas)) {
          fail("failed-precondition", `Sale amount for product ${item.productId} exceeds supported limits.`);
        }

        subtotalPesewas += lineTotalPesewas;
        items.push({
          productId: item.productId,
          name: String(product.name || item.productId),
          quantity: item.quantity,
          unit: item.unit,
          baseQuantity,
          unitPricePesewas: pricing.unitPricePesewas,
          lineTotalPesewas
        });
        transaction.update(productRef, {
          quantity: currentQuantity - baseQuantity,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: uid
        });
      }

      if (!Number.isSafeInteger(subtotalPesewas)) {
        fail("failed-precondition", "Sale subtotal exceeds supported limits.");
      }

      const taxBreakdown = calculateTax(subtotalPesewas, taxSettings);
      const committedAt = new Date().toISOString();
      const createdBy = {
        uid,
        fullName: profile.fullName || profile.displayName || profile.username || uid,
        username: profile.username || "",
        role: profile.role
      };
      const response = createSaleResponse({
        saleId: saleRef.id,
        committedAt,
        items,
        subtotalPesewas,
        taxBreakdown,
        paymentMethod: payload.paymentMethod,
        createdBy
      });

      transaction.set(saleRef, {
        ...response,
        schemaVersion: 2,
        idempotencyKeyHash: requestHash,
        createdAt: FieldValue.serverTimestamp(),
        cloudSyncedAt: FieldValue.serverTimestamp()
      });
      transaction.set(requestRef, {
        schemaVersion: 1,
        uid,
        requestFingerprint,
        saleId: saleRef.id,
        response,
        createdAt: FieldValue.serverTimestamp()
      });

      return response;
    });
  }

  return {
    submitSecureSale
  };
}

module.exports = {
  DEFAULT_TAX_SETTINGS,
  createSecureSalesService
};
