import assert from "node:assert/strict";
import test from "node:test";
import { getReportSaleProfit } from "../js/services/reportProfit.js";

test("report profit keeps unknown-cost provisional and opening sales unknown", () => {
  assert.equal(getReportSaleProfit({ costStatus: "unknown", profit: null }), null);
  assert.equal(getReportSaleProfit({ profit: null }), null);
  assert.equal(getReportSaleProfit({ totalProfit: null }), null);
  assert.equal(getReportSaleProfit({ profit: 12.5 }), 12.5);
  assert.equal(getReportSaleProfit({}), 0);
});
