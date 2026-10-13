import { getPagePermission } from "./pagePermissions.js";

export const DASHBOARD_PAGE = "dashboard";

// Keep bookmarked and legacy Home links working while making Dashboard the hub.
export function normalizeNavigationPage(page) {
  return page === "home" ? DASHBOARD_PAGE : page;
}

export function canAccessPageWithPermission(page, hasPermission) {
  const destination = normalizeNavigationPage(page);
  const requiredPermission = getPagePermission(destination);

  // Dashboard is the authenticated application's hub. Feature permissions
  // continue to govern the actions and data shown inside it.
  if (destination === DASHBOARD_PAGE || !requiredPermission) {
    return true;
  }

  return typeof hasPermission === "function" && hasPermission(requiredPermission);
}

export function canAccessReportAction(hasPermission) {
  return canAccessPageWithPermission("reports", hasPermission);
}
