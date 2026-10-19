const ACTIVE = (product) => product.active !== false && product.isActive !== false;

export function getAccraBusinessDay(now = new Date()) {
  const parts = /** @type {Record<string, string>} */ (new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {}));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) };
}

export function weeklyCycleKey(day, scheduledWeekday) {
  const value = new Date(`${day}T12:00:00.000Z`);
  const currentWeekday = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - ((currentWeekday - scheduledWeekday + 7) % 7));
  return value.toISOString().slice(0, 10);
}

// A schedule begins only when it is persisted. No historic week is inferred as
// completed. Finalised category reports combine only for their listed legacy
// products; v2 products remain explicitly outside this legacy activity.
export function getWeeklyStocktakingAlert(currentState, now = new Date()) {
  const setting = currentState.weeklyStocktakingSettings;
  if (!setting || !Number.isInteger(setting.scheduledWeekday)) return { message: "Sunday is the default weekly due day. Start a category count to begin this week's coverage." };
  const today = getAccraBusinessDay(now);
  const scheduledWeekday = setting.scheduledWeekday;
  const cycle = weeklyCycleKey(today.date, scheduledWeekday);
  if (setting.effectiveFromBusinessDate && cycle < setting.effectiveFromBusinessDate) return null;
  const activeProducts = (currentState.products || []).filter(ACTIVE);
  const unsupportedV2 = activeProducts.filter((product) => Number(product.inventorySchemaVersion) === 2);
  const required = new Set(activeProducts.filter((product) => Number(product.inventorySchemaVersion) !== 2).map((product) => product.id));
  const covered = new Set();
  (currentState.stocktakeSessions || []).filter((session) => session.status === "finalised" && session.obligationWeekKey === cycle).forEach((session) => (session.items || []).forEach((item) => covered.add(item.productId)));
  const completed = required.size > 0 && [...required].every((id) => covered.has(id));
  const v2Note = unsupportedV2.length ? ` ${unsupportedV2.length} v2 product${unsupportedV2.length === 1 ? " is" : "s are"} outside this legacy activity.` : "";
  if (completed && !unsupportedV2.length) return null;
  if (completed) return { message: `Finalised reports cover all supported legacy products.${v2Note}` };
  if (today.weekday === ((scheduledWeekday + 6) % 7)) return { message: `Stocktaking is tomorrow.${v2Note}` };
  if (today.weekday === scheduledWeekday) return { message: `Stocktaking is due today.${v2Note}` };
  if (((today.weekday - scheduledWeekday + 7) % 7) > 0) return { message: `Weekly stocktaking is overdue. Sales can continue, but a finalised complete count is required.${v2Note}` };
  return null;
}
