import { saveTaxSettingsToCloud } from "../services/taxSettingsService.js";

const { renderPage, saveState, state } = window.app;

const defaultTaxSettings = {
  enabled: true,
  vatRate: 15,
  nhilRate: 2.5,
  getfundRate: 2.5,
  withholdingVatRate: 7,
  effectiveDate: "",
  taxMode: "standard"
};

function getTaxSettings() {
  return {
    ...defaultTaxSettings,
    ...(state.settings?.tax || {})
  };
}

function renderTaxSettings(error = "", values = getTaxSettings()) {
  const current = {
    ...defaultTaxSettings,
    ...values
  };

  renderPage(`
    <div class="page-title">
      <h2>Tax Settings</h2>
      <p>Manage the Ghana tax rates that apply to sales and receipts.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <form class="form-column panel" onsubmit="saveTaxSettings(event)">
      <div class="form-row">
        <label for="taxEnabled">Tax Enabled</label>
        <select id="taxEnabled">
          <option value="true" ${current.enabled ? "selected" : ""}>Yes</option>
          <option value="false" ${!current.enabled ? "selected" : ""}>No</option>
        </select>
      </div>

      <div class="form-row">
        <label for="taxMode">Tax Mode</label>
        <select id="taxMode">
          <option value="standard" ${current.taxMode === "standard" ? "selected" : ""}>Standard Rated</option>
          <option value="exempt" ${current.taxMode === "exempt" ? "selected" : ""}>Exempt</option>
          <option value="zeroRated" ${current.taxMode === "zeroRated" ? "selected" : ""}>Zero Rated</option>
        </select>
      </div>

      <div class="form-row">
        <label for="vatRate">VAT Rate (%)</label>
        <input id="vatRate" class="number-field" type="number" min="0" step="0.1" value="${current.vatRate}">
      </div>

      <div class="form-row">
        <label for="nhilRate">NHIL Rate (%)</label>
        <input id="nhilRate" class="number-field" type="number" min="0" step="0.1" value="${current.nhilRate}">
      </div>

      <div class="form-row">
        <label for="getfundRate">GETFund Rate (%)</label>
        <input id="getfundRate" class="number-field" type="number" min="0" step="0.1" value="${current.getfundRate}">
      </div>

      <div class="form-row">
        <label for="withholdingVatRate">Withholding VAT Rate (%)</label>
        <input id="withholdingVatRate" class="number-field" type="number" min="0" step="0.1" value="${current.withholdingVatRate}">
      </div>

      <div class="form-row">
        <label for="effectiveDate">Effective Date</label>
        <input id="effectiveDate" type="date" value="${current.effectiveDate || ""}">
      </div>

      <button type="submit">Save Tax Settings</button>
      <button type="button" onclick="navigate('home')">Back to Menu</button>
    </form>
  `);
}

async function saveTaxSettings(event) {
  event?.preventDefault?.();

  const enabled = document.getElementById("taxEnabled")?.value === "true";
  const taxMode = document.getElementById("taxMode")?.value || "standard";
  const vatRate = Number(document.getElementById("vatRate")?.value || 0);
  const nhilRate = Number(document.getElementById("nhilRate")?.value || 0);
  const getfundRate = Number(document.getElementById("getfundRate")?.value || 0);
  const withholdingVatRate = Number(document.getElementById("withholdingVatRate")?.value || 0);
  const effectiveDate = document.getElementById("effectiveDate")?.value || "";

  if (vatRate < 0 || nhilRate < 0 || getfundRate < 0 || withholdingVatRate < 0) {
    renderTaxSettings("Tax rates cannot be negative.");
    return;
  }

  state.settings = {
    ...(state.settings || {}),
    tax: {
      enabled,
      taxMode,
      vatRate,
      nhilRate,
      getfundRate,
      withholdingVatRate,
      effectiveDate
    }
  };

  try {
    await saveTaxSettingsToCloud(state.settings.tax);
    saveState();
    renderTaxSettings("Tax settings saved successfully.");
  } catch (error) {
    renderTaxSettings(error.message || "Unable to save tax settings.");
  }
}

window.renderTaxSettings = renderTaxSettings;
window.saveTaxSettings = saveTaxSettings;
