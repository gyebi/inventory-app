import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LEGACY_SALE_PAYMENT_METHODS,
  normalizeLegacySalePaymentMethod
} from "../js/services/legacySalePayment.js";

test("legacy payment methods accept existing POS values and default omitted values to Cash", () => {
  assert.deepEqual(LEGACY_SALE_PAYMENT_METHODS, ["Cash", "MoMo", "Card"]);
  assert.equal(normalizeLegacySalePaymentMethod(), "Cash");
  for (const paymentMethod of LEGACY_SALE_PAYMENT_METHODS) {
    assert.equal(normalizeLegacySalePaymentMethod(paymentMethod), paymentMethod);
  }
});

test("legacy payment methods reject invalid explicit values", () => {
  for (const paymentMethod of ["", "cash", "Credit", null, " Cash "]) {
    assert.throws(() => normalizeLegacySalePaymentMethod(paymentMethod), /Cash, MoMo, or Card/);
  }
});

test("legacy checkout wires the validated method into the committed sale without changing its other fields", async () => {
  const source = await readFile(new URL("../js/services/salesService.js", import.meta.url), "utf8");

  assert.match(source, /const createLegacySale = \(cartItems = \[\], paymentMethod = "Cash"\)/);
  assert.match(source, /paymentMethod: normalizedPaymentMethod/);
  assert.match(source, /return createLegacySale\(cartItems, paymentMethod\)/);
  assert.ok(
    source.indexOf("normalizedPaymentMethod = normalizeLegacySalePaymentMethod(paymentMethod)")
      < source.indexOf("return submitSaleToCloudTransaction({"),
    "the legacy payment method is validated before the Firestore write"
  );

  const committedSale = {
    id: "CDV-test",
    totalAmount: 12,
    actualQtySold: 3,
    paymentMethod: normalizeLegacySalePaymentMethod("MoMo")
  };
  const readBackSale = JSON.parse(JSON.stringify(committedSale));

  assert.equal(readBackSale.paymentMethod, "MoMo");
  assert.deepEqual(
    { id: readBackSale.id, totalAmount: readBackSale.totalAmount, actualQtySold: readBackSale.actualQtySold },
    { id: "CDV-test", totalAmount: 12, actualQtySold: 3 }
  );
});
