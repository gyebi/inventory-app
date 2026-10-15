const { renderPage } = /** @type {any} */ (window).app;

function renderReceiptDeliveryPrototype() {
  renderPage(`
    <section class="prototype-page" aria-labelledby="receiptPrototypeTitle">
      <div class="prototype-banner"><span>Presentation prototype</span><h2 id="receiptPrototypeTitle">Receipt delivery choice</h2><p>This isolated screen does not send SMS, retain phone numbers, or connect to completed sales.</p></div>
      <section class="prototype-panel receipt-delivery-prototype">
        <h3>Choose delivery</h3>
        <div class="receipt-delivery-options" role="radiogroup" aria-label="Receipt delivery method">
          <label><input type="radio" name="receiptDelivery" checked> <span><strong>Print receipt</strong><small>Printer delivery placeholder</small></span></label>
          <label><input type="radio" name="receiptDelivery"> <span><strong>SMS receipt</strong><small>Delivery placeholder only</small></span></label>
          <label><input type="radio" name="receiptDelivery"> <span><strong>Both</strong><small>Delivery placeholder only</small></span></label>
        </div>
        <label class="prototype-phone-field">Ghana mobile number<input type="tel" inputmode="tel" autocomplete="tel-national" placeholder="024 123 4567" aria-describedby="smsPrototypeHelp"><small id="smsPrototypeHelp">For UI preview only. This value is not sent or saved.</small></label>
        <div class="prototype-delivery-status"><span aria-hidden="true">○</span><div><strong>Delivery status</strong><small>Awaiting delivery service connection</small></div></div>
        <button type="button" disabled>Preview delivery state</button>
      </section>
    </section>
  `);
}

/** @type {any} */ (window).renderReceiptDeliveryPrototype = renderReceiptDeliveryPrototype;

export {};
