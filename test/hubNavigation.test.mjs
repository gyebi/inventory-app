import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DASHBOARD_PAGE,
  canAccessPageWithPermission,
  canAccessReportAction,
  normalizeNavigationPage
} from "../js/utils/hubNavigation.js";

const permits = (permissions) => (permission) => permissions.includes("all") || permissions.includes(permission);

test("restricted users can open the dashboard hub without business-report access", () => {
  const storekeeperPermissions = permits(["add_product", "manage_stock"]);

  assert.equal(canAccessPageWithPermission("dashboard", storekeeperPermissions), true);
  assert.equal(canAccessPageWithPermission("home", storekeeperPermissions), true);
  assert.equal(canAccessPageWithPermission("inventory", storekeeperPermissions), true);
  assert.equal(canAccessPageWithPermission("reports", storekeeperPermissions), false);
  assert.equal(canAccessReportAction(storekeeperPermissions), false);
});

test("unauthorized direct report destinations and report actions remain blocked", () => {
  const salesPermissions = permits(["create_sale", "view_dashboard"]);

  assert.equal(canAccessPageWithPermission("reports", salesPermissions), false);
  assert.equal(canAccessReportAction(salesPermissions), false);
  assert.equal(canAccessPageWithPermission("staff", salesPermissions), false);
});

test("legacy home navigation aliases to Dashboard", () => {
  assert.equal(normalizeNavigationPage("home"), DASHBOARD_PAGE);
  assert.equal(normalizeNavigationPage("dashboard"), DASHBOARD_PAGE);
});

test("login, session restoration, and required-password entry routes target Dashboard", async () => {
  const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

  for (const routeHandler of ["renderCurrentEntryPage", "login", "completeRequiredPasswordChange"]) {
    const handlerStart = appSource.indexOf(`function ${routeHandler}`);
    const handlerEnd = appSource.indexOf("\nfunction ", handlerStart + 1);
    const handler = appSource.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd);

    assert.match(handler, /navigate\("dashboard"\)/);
  }
});
