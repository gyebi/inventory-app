import assert from "node:assert/strict";
import test from "node:test";
import { getAccraBusinessDay, getWeeklyStocktakingAlert, weeklyCycleKey } from "../js/utils/weeklyStocktakingSchedule.js";

const products = [
  { id: "water", active: true, category: "Water" },
  { id: "juice", active: true, category: "Juice" }
];
const setting = { scheduledWeekday: 0, effectiveFromBusinessDate: "2025-12-28" };
const state = (sessions = [], extraProducts = products) => ({ products: extraProducts, stocktakeSessions: sessions, weeklyStocktakingSettings: setting });

test("Africa/Accra dates keep Saturday, Sunday, Monday, and year-boundary reminders correct", () => {
  assert.deepEqual(getAccraBusinessDay(new Date("2026-01-03T23:30:00.000Z")), { date: "2026-01-03", weekday: 6 });
  assert.equal(weeklyCycleKey("2026-01-04", 0), "2026-01-04");
  assert.match(getWeeklyStocktakingAlert(state(), new Date("2026-01-03T12:00:00.000Z")).message, /tomorrow/i);
  assert.match(getWeeklyStocktakingAlert(state(), new Date("2026-01-04T12:00:00.000Z")).message, /due today/i);
  assert.match(getWeeklyStocktakingAlert(state(), new Date("2026-01-05T12:00:00.000Z")).message, /overdue/i);
});

test("only finalised coverage for every selected legacy product clears the weekly reminder", () => {
  const week = "2026-01-04";
  const waterOnly = [{ status: "finalised", obligationWeekKey: week, items: [{ productId: "water" }] }];
  assert.match(getWeeklyStocktakingAlert(state(waterOnly), new Date("2026-01-05T12:00:00.000Z")).message, /overdue/i);
  const complete = [...waterOnly, { status: "finalised", obligationWeekKey: week, items: [{ productId: "juice" }] }];
  assert.equal(getWeeklyStocktakingAlert(state(complete), new Date("2026-01-05T12:00:00.000Z")), null);
  assert.match(getWeeklyStocktakingAlert(state(complete, [...products, { id: "secure", active: true, inventorySchemaVersion: 2 }]), new Date("2026-01-05T12:00:00.000Z")).message, /outside this legacy activity/i);
});

test("first run and schedule changes do not imply historical completion", () => {
  assert.match(getWeeklyStocktakingAlert({ products, stocktakeSessions: [], weeklyStocktakingSettings: null }).message, /Sunday is the default/i);
  const changed = { scheduledWeekday: 1, effectiveFromBusinessDate: "2026-01-05" };
  assert.equal(getWeeklyStocktakingAlert({ products, stocktakeSessions: [], weeklyStocktakingSettings: changed }, new Date("2026-01-04T12:00:00.000Z")), null);
  assert.match(getWeeklyStocktakingAlert({ products, stocktakeSessions: [], weeklyStocktakingSettings: changed }, new Date("2026-01-05T12:00:00.000Z")).message, /due today/i);
});
