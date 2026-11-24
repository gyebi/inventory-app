export const LEGACY_SALE_PAYMENT_METHODS = Object.freeze(["Cash", "MoMo", "Card"]);

export function normalizeLegacySalePaymentMethod(paymentMethod = "Cash") {
  if (!LEGACY_SALE_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new RangeError("Payment method must be Cash, MoMo, or Card.");
  }

  return paymentMethod;
}
