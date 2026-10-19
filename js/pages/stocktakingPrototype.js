import {
  createPersistedRequestKey,
  evaluateWeeklyStocktake,
  finaliseWeeklyStocktake,
  saveWeeklyStocktakeCounts,
  startWeeklyStocktake,
  updateWeeklyStocktakeSchedule
} from "../services/legacyStocktakingService.js";

const { renderPage, state } = /** @type {any} */ (window).app;
let selectedSessionId = "";
let selectedCategory = "";
const pendingCountValues = new Map();
const pendingReasonValues = new Map();

const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const isReviewer = () => ["admin", "manager"].includes(state.user?.role);
const isAdmin = () => state.user?.role === "admin";

function currentSession() {
  const sessions = Array.isArray(state.stocktakeSessions) ? state.stocktakeSessions : [];
  return sessions.find((session) => session.id === selectedSessionId) || sessions.slice().sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))[0] || null;
}

function inputKey(sessionId, productId) {
  return `${sessionId}:${productId}`;
}

function capturePendingInputs() {
  const session = currentSession();
  if (!session) return;
  /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(".stocktake-count")).forEach((input) => {
    pendingCountValues.set(inputKey(session.id, input.dataset.productId || ""), input.value);
  });
  /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(".stocktake-reason")).forEach((input) => {
    pendingReasonValues.set(inputKey(session.id, input.dataset.productId || ""), input.value);
  });
}

function rememberSession(session) {
  const sessions = Array.isArray(state.stocktakeSessions) ? state.stocktakeSessions : [];
  state.stocktakeSessions = [session, ...sessions.filter((item) => item.id !== session.id)];
}

function renderStocktakingPrototype(message = "", error = false) {
  capturePendingInputs();
  const session = currentSession();
  const legacyCategories = [...new Set((state.products || []).filter((product) => Number(product.inventorySchemaVersion) !== 2 && product.active !== false && product.isActive !== false).map((product) => product.category).filter(Boolean))].sort();
  const v2Categories = new Set((state.products || []).filter((product) => Number(product.inventorySchemaVersion) === 2 && product.active !== false && product.isActive !== false).map((product) => product.category));
  const reports = (state.stocktakeSessions || []).slice().sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || ""))).slice(0, 10);
  renderPage(`
    <section class="prototype-page" aria-labelledby="stocktakingTitle">
      <div class="prototype-banner"><span>Weekly activity</span><h2 id="stocktakingTitle">Stocktaking</h2><p>Compare app quantities with a physical count. Saving and finalising a report never changes inventory.</p></div>
      ${message ? `<div class="message ${error ? "error" : "success"}">${escapeHtml(message)}</div>` : ""}
      <section class="prototype-panel"><h3>Start category count</h3><div class="prototype-form"><label>Category<select id="stocktakeCategory"><option value="">Choose a category</option>${legacyCategories.map((category) => `<option value="${escapeHtml(category)}" ${category === selectedCategory ? "selected" : ""}>${escapeHtml(category)}${v2Categories.has(category) ? " — contains unsupported v2 products" : ""}</option>`).join("")}</select></label><button type="button" onclick="startSimpleStocktake()">Begin count</button></div><p class="field-hint">Only legacy categories are supported. If a category contains v2 products, the server identifies them and does not start a partial count.</p></section>
      ${session ? renderSession(session) : ""}
      ${isAdmin() ? renderSchedule() : ""}
      <section class="prototype-panel"><h3>Saved drafts and reports</h3><div class="prototype-list">${reports.length ? reports.map((item) => `<div><div><strong>${escapeHtml(item.category || "Unknown category")}</strong><small>${escapeHtml(item.status || "draft")} · ${escapeHtml(item.startedBy?.fullName || "Unknown user")}</small></div><button type="button" onclick="openSimpleStocktake('${escapeHtml(item.id)}')">Open</button></div>`).join("") : "<p>No saved counts yet.</p>"}</div></section>
    </section>`);
}

function renderSession(session) {
  const draft = session.status === "draft";
  const evaluated = session.status === "evaluated";
  const finalised = session.status === "finalised";
  const rows = (session.items || []).map((item) => {
    const pack = item.unitsPerBulk > 1 ? ` · ${Math.floor(item.snapshotBaseQuantity / item.unitsPerBulk)} ${escapeHtml(item.bulkUnit)} + ${item.snapshotBaseQuantity % item.unitsPerBulk} ${escapeHtml(item.baseUnit)}` : "";
    const actual = item.actualBaseQuantity === null || item.actualBaseQuantity === undefined ? "" : item.actualBaseQuantity;
    const key = inputKey(session.id, item.productId);
    const pendingCount = pendingCountValues.has(key) ? pendingCountValues.get(key) : actual;
    const pendingReason = pendingReasonValues.has(key) ? pendingReasonValues.get(key) : (item.reason || "");
    const reasonField = item.varianceBaseQuantity !== 0 && !finalised
      ? (isReviewer() ? `<label>Reason<input class="stocktake-reason" data-product-id="${escapeHtml(item.productId)}" value="${escapeHtml(pendingReason)}" maxlength="4000"></label>` : "<small>A manager or admin must add a reason before finalising.</small>")
      : item.varianceBaseQuantity !== 0 ? `<small>Reason: ${escapeHtml(item.reason || "Missing")}</small>` : "";
    return `<div class="prototype-count-card"><div><strong>${escapeHtml(item.productName)}</strong><small>Unit: ${escapeHtml(item.baseUnit)}${pack}</small></div><div><strong>App quantity:</strong> ${item.snapshotBaseQuantity} ${escapeHtml(item.baseUnit)}</div>${draft ? `<label>Actual count (${escapeHtml(item.baseUnit)})<input class="stocktake-count" data-product-id="${escapeHtml(item.productId)}" type="number" min="0" step="1" value="${escapeHtml(pendingCount)}" placeholder="Blank = not counted"></label>` : `<div><strong>Actual count:</strong> ${actual === "" ? "Not counted" : `${actual} ${escapeHtml(item.baseUnit)}`}</div>`}${evaluated || finalised ? `<div><strong>Variance:</strong> ${item.varianceBaseQuantity} ${escapeHtml(item.baseUnit)}</div>${reasonField}` : ""}</div>`;
  }).join("");
  const actions = draft ? `<div class="form-actions"><button type="button" onclick="saveSimpleStocktake()">Save draft</button>${isReviewer() ? `<button type="button" onclick="evaluateSimpleStocktake()">Evaluate</button>` : ""}</div>` : evaluated && isReviewer() ? `<button type="button" onclick="finaliseSimpleStocktake()">Finalise report</button>` : "";
  const stale = session.status === "stale" ? `<div class="message error">Stock or packaging changed after the snapshot for: ${escapeHtml((session.staleProducts || []).join(", "))}. Start a fresh count; this report cannot be evaluated.</div>` : "";
  return `<section class="prototype-panel"><h3>${escapeHtml(session.category)} count</h3><p>Status: <strong>${escapeHtml(session.status || "draft")}</strong>. App quantities are the server snapshot taken when this count started.</p>${stale}<div class="prototype-list">${rows}</div>${actions}<p class="field-hint">Evaluation checks the saved quantity, units, pack conversion, and stock update marker. This legacy mode has no immutable movement ledger: a direct no-op edit that preserves its update marker cannot be distinguished, so products without a marker are conservatively rejected as stale.</p>${finalised ? `<p class="message success">Finalised reports are read-only and do not create stock adjustments.</p>` : ""}</section>`;
}

function renderSchedule() {
  const selected = Number(state.weeklyStocktakingSettings?.scheduledWeekday ?? 0);
  return `<section class="prototype-panel"><h3>Weekly reminder</h3><div class="form-row"><label for="weeklyScheduleDay">Due day</label><select id="weeklyScheduleDay">${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => `<option value="${index}" ${selected === index ? "selected" : ""}>${day}</option>`).join("")}</select></div><button type="button" onclick="saveSimpleStocktakeSchedule()">Save due day</button><p class="field-hint">Drafts do not clear reminders. A finalised category report only covers the products in that category.</p></section>`;
}

async function startSimpleStocktake() {
  const categoryInput = /** @type {HTMLSelectElement | null} */ (document.getElementById("stocktakeCategory"));
  const category = categoryInput?.value || "";
  selectedCategory = category;
  try { const response = await startWeeklyStocktake({ idempotencyKey: createPersistedRequestKey("stocktake"), category }); rememberSession(response.session); selectedSessionId = response.session.id; renderStocktakingPrototype("Category snapshot created. Enter actual counts in base units."); } catch (error) { renderStocktakingPrototype(error.message || "Unable to start this count.", true); }
}

function collectCounts() {
  capturePendingInputs();
  const session = currentSession();
  if (!session) return [];
  return (session.items || []).map((item) => {
    const value = pendingCountValues.get(inputKey(session.id, item.productId));
    return { productId: item.productId, quantity: value === "" || value === undefined ? null : Number(value), unit: "base" };
  });
}
async function saveSimpleStocktake() {
  const session = currentSession(); if (!session) return;
  const counts = collectCounts();
  if (counts.some((count) => count.quantity !== null && (!Number.isSafeInteger(count.quantity) || count.quantity < 0))) { renderStocktakingPrototype("Actual counts must be whole base-unit quantities. Leave a field blank if it was not counted.", true); return; }
  try { const response = await saveWeeklyStocktakeCounts({ sessionId: session.id, revision: session.revision, counts }); rememberSession(response.session); selectedSessionId = response.session.id; renderStocktakingPrototype("Draft saved. Blank values remain not counted."); } catch (error) { renderStocktakingPrototype(error.message || "Unable to save this draft.", true); }
}
async function evaluateSimpleStocktake() { const session = currentSession(); if (!session) return; try { const response = await evaluateWeeklyStocktake({ sessionId: session.id, revision: session.revision }); rememberSession(response.session); selectedSessionId = response.session.id; renderStocktakingPrototype(response.committed ? "Variance report ready. Add reasons for all differences." : response.message, !response.committed); } catch (error) { renderStocktakingPrototype(error.message || "Unable to evaluate this count.", true); } }
async function finaliseSimpleStocktake() { const session = currentSession(); if (!session) return; capturePendingInputs(); const reasons = (session.items || []).map((item) => ({ productId: item.productId, reason: pendingReasonValues.get(inputKey(session.id, item.productId)) || "" })); try { const response = await finaliseWeeklyStocktake({ sessionId: session.id, revision: session.revision, reasons }); rememberSession(response.session); selectedSessionId = response.session.id; renderStocktakingPrototype("Report finalised. Inventory was not changed."); } catch (error) { renderStocktakingPrototype(error.message || "Unable to finalise this report.", true); } }
async function saveSimpleStocktakeSchedule() { const input = /** @type {HTMLSelectElement | null} */ (document.getElementById("weeklyScheduleDay")); try { await updateWeeklyStocktakeSchedule({ scheduledWeekday: Number(input?.value || 0) }); renderStocktakingPrototype("Weekly reminder updated."); } catch (error) { renderStocktakingPrototype(error.message || "Unable to update the reminder.", true); } }
function openSimpleStocktake(id) { selectedSessionId = id; renderStocktakingPrototype(); }

Object.assign(window, { renderStocktakingPrototype, startSimpleStocktake, saveSimpleStocktake, evaluateSimpleStocktake, finaliseSimpleStocktake, saveSimpleStocktakeSchedule, openSimpleStocktake });
export {};
