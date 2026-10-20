"use strict";

const TAX_MODES = new Set(["standard", "zeroRated", "exempt"]);
const DEFAULT_TAX_SETTINGS = {
  enabled: true, vatRate: 15, nhilRate: 2.5, getfundRate: 2.5, withholdingVatRate: 7, effectiveDate: null, taxMode: "standard"
};

function createSaleTaxHelpers({ fail, add, multiply }) {
  function normalizedTax(data = {}) {
    const settings = { ...DEFAULT_TAX_SETTINGS, ...data };
    const taxMode = String(settings.taxMode || DEFAULT_TAX_SETTINGS.taxMode);
    if (!TAX_MODES.has(taxMode)) fail("failed-precondition", "settings/tax contains an unsupported taxMode.");
    const rate = (value, field) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 100) fail("failed-precondition", `${field} must be a percentage from 0 to 100.`);
      return Math.round(number * 100);
    };
    return {
      enabled: settings.enabled !== false && taxMode !== "exempt", taxMode, effectiveDate: settings.effectiveDate || null,
      vatRateBasisPoints: rate(settings.vatRate, "settings/tax.vatRate"),
      nhilRateBasisPoints: rate(settings.nhilRate, "settings/tax.nhilRate"),
      getfundRateBasisPoints: rate(settings.getfundRate, "settings/tax.getfundRate"),
      withholdingVatRateBasisPoints: rate(settings.withholdingVatRate, "settings/tax.withholdingVatRate")
    };
  }

  function calculateTax(subtotalPesewas, tax) {
    const percentage = (basisPoints, field) => Math.round(multiply(subtotalPesewas, basisPoints, field) / 10000);
    const chargeable = tax.enabled && tax.taxMode === "standard";
    const vatAmountPesewas = chargeable ? percentage(tax.vatRateBasisPoints, "VAT") : 0;
    const nhilAmountPesewas = chargeable ? percentage(tax.nhilRateBasisPoints, "NHIL") : 0;
    const getfundAmountPesewas = chargeable ? percentage(tax.getfundRateBasisPoints, "GETFund") : 0;
    const withholdingVatAmountPesewas = chargeable ? percentage(tax.withholdingVatRateBasisPoints, "withholding VAT") : 0;
    const taxAmountPesewas = add(add(vatAmountPesewas, nhilAmountPesewas, "tax total"), getfundAmountPesewas, "tax total");
    return { ...tax, enabled: chargeable, subtotalPesewas, vatAmountPesewas, nhilAmountPesewas, getfundAmountPesewas, withholdingVatAmountPesewas, taxAmountPesewas, totalAmountPesewas: add(subtotalPesewas, taxAmountPesewas, "sale total") };
  }

  function legacyTax(tax) {
    return {
      subtotal: tax.subtotalPesewas / 100, vatRate: tax.vatRateBasisPoints / 100, nhilRate: tax.nhilRateBasisPoints / 100, getfundRate: tax.getfundRateBasisPoints / 100, withholdingVatRate: tax.withholdingVatRateBasisPoints / 100,
      vatAmount: tax.vatAmountPesewas / 100, nhilAmount: tax.nhilAmountPesewas / 100, getfundAmount: tax.getfundAmountPesewas / 100, withholdingVatAmount: tax.withholdingVatAmountPesewas / 100,
      taxAmount: tax.taxAmountPesewas / 100, totalAmount: tax.totalAmountPesewas / 100, taxMode: tax.taxMode, enabled: tax.enabled, effectiveDate: tax.effectiveDate
    };
  }

  return { normalizedTax, calculateTax, legacyTax };
}

module.exports = { DEFAULT_TAX_SETTINGS, createSaleTaxHelpers };
