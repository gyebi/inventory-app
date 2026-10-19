import {
  generateReceiptText,
  formatReceiptReference
} from "./receiptService.js";
import { printAndroidRawBtReceipt } from "./androidRawBtPrinterService.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderAndroidRawBtReceiptPage(sale) {
  // Retain the committed receipt snapshot, not live product prices or labels.
  const snapshot = JSON.parse(JSON.stringify(sale));
  let handedOff = false;
  let busy = false;
  const appWindow = /** @type {any} */ (window);

  appWindow.printAndroidSaleReceipt = () => {
    if (busy) return;
    if (handedOff &&
        !window.confirm("Print another copy? Check whether the previous receipt printed first.")) {
      return;
    }

    const button = /** @type {HTMLButtonElement | null} */ (
      document.getElementById("androidPrintReceiptButton")
    );
    const message = document.getElementById("androidPrintReceiptMessage");

    try {
      busy = true;
      if (button) button.disabled = true;

      // Keep the handoff synchronous with the user's tap.
      printAndroidRawBtReceipt(snapshot);
      handedOff = true;

      if (message) {
        message.textContent =
          "RawBT handoff requested. Check that the receipt printed.";
      }
      if (button) button.textContent = "Print again";
    } catch (error) {
      if (message) {
        message.textContent = error.message || "Unable to open RawBT.";
      }
    } finally {
      setTimeout(() => {
        busy = false;
        if (button) button.disabled = false;
      }, 1500);
    }
  };

  appWindow.app.renderPage(`
    <div class="page-title">
      <h2>Receipt</h2>
      <p>Android / RawBT - 58 mm</p>
    </div>
    <div class="card">
      <strong>Receipt ${escapeHtml(formatReceiptReference(snapshot))}</strong>
      <pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font-size:14px;line-height:1.5">${escapeHtml(generateReceiptText(snapshot))}</pre>
    </div>
    <p id="androidPrintReceiptMessage" role="status" aria-live="polite">
      Tap Print receipt to open RawBT.
    </p>
    <div class="receipt-actions">
      <button id="androidPrintReceiptButton" type="button"
        onclick="printAndroidSaleReceipt()">Print receipt</button>
      <button type="button" onclick="navigate('sales')">Back to Sale</button>
    </div>
  `);
}
