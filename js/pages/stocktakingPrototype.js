const { renderPage } = /** @type {any} */ (window).app;

let activeStocktakingScreen = "overview";

const screens = {
  overview: {
    title: "Stocktaking overview",
    body: `
      <div class="prototype-summary-grid">
        <article><span>Planned cadence</span><strong>Weekly</strong><small>Prototype only</small></article>
        <article><span>Example sessions</span><strong>2</strong><small>Mock records</small></article>
        <article><span>Pending review</span><strong>1</strong><small>Manager review placeholder</small></article>
      </div>
      <div class="prototype-list">
        <div><div><strong>Week of 14 Oct</strong><small>Mock session · counting in progress</small></div><b>Continue</b></div>
        <div><div><strong>Week of 07 Oct</strong><small>Mock session · awaiting approval</small></div><b>Review</b></div>
      </div>`
  },
  session: {
    title: "New counting session",
    body: `
      <div class="prototype-form">
        <label>Session name<input value="Weekly count — 14 Oct" readonly></label>
        <label>Count date<input type="date" value="2026-10-14" readonly></label>
        <label>Assigned counter<select disabled><option>Example staff member</option></select></label>
        <p>This is a visual prototype. Starting a session does not create a record or change stock.</p>
        <button type="button" disabled>Start mock session</button>
      </div>`
  },
  count: {
    title: "Physical count entry",
    body: `
      <div class="prototype-count-card"><div><strong>Example product</strong><small>System quantity is intentionally hidden while counting.</small></div><label>Physical count<input inputmode="numeric" value="" placeholder="Enter quantity"></label><button type="button" disabled>Next item</button></div>
      <p class="prototype-note">No operational product names or quantities are shown here; these controls are disconnected mock UI.</p>`
  },
  variance: {
    title: "Variance review",
    body: `
      <div class="prototype-variance"><div><span>Example product A</span><b class="prototype-negative">− 2 units</b><small>Mock variance</small></div><div><span>Example product B</span><b class="prototype-positive">+ 1 unit</b><small>Mock variance</small></div></div>
      <p class="prototype-note">Review is illustrative only. It never posts stock adjustments.</p>`
  },
  approval: {
    title: "Manager approval view",
    body: `
      <div class="prototype-approval"><span>Approval status</span><strong>Awaiting manager review</strong><p>Approval and rejection controls are disabled in this prototype. No business rule or stock adjustment has been added.</p><div><button type="button" disabled>Approve mock session</button><button type="button" disabled>Return for recount</button></div></div>`
  }
};

function renderStocktakingPrototype() {
  const screen = screens[activeStocktakingScreen] || screens.overview;
  renderPage(`
    <section class="prototype-page" aria-labelledby="stocktakingPrototypeTitle">
      <div class="prototype-banner"><span>Planning prototype</span><h2 id="stocktakingPrototypeTitle">Weekly stocktaking</h2><p>Isolated mock interface — not connected to inventory, Firestore, or stock adjustments.</p></div>
      <div class="prototype-tabs" role="tablist" aria-label="Stocktaking prototype screens">
        ${Object.entries(screens).map(([key, item]) => `<button type="button" role="tab" aria-selected="${key === activeStocktakingScreen}" class="${key === activeStocktakingScreen ? "is-active" : ""}" onclick="setStocktakingPrototypeScreen('${key}')">${item.title}</button>`).join("")}
      </div>
      <section class="prototype-panel"><h3>${screen.title}</h3>${screen.body}</section>
    </section>
  `);
}

function setStocktakingPrototypeScreen(screen) {
  if (!screens[screen]) return;
  activeStocktakingScreen = screen;
  renderStocktakingPrototype();
}

/** @type {any} */ (window).renderStocktakingPrototype = renderStocktakingPrototype;
/** @type {any} */ (window).setStocktakingPrototypeScreen = setStocktakingPrototypeScreen;

export {};
