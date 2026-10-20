export const pagePermissions = {
  // Dashboard is available to every authenticated user. Its figures and
  // actions remain individually limited by the permissions below.
  dashboard: null,
  sales: "create_sale",
  receiveStock: "manage_stock",
  stockAdjustment: "manage_stock",
  supplierPayment: "manage_stock",
  priceChanges: "manage_settings",
  printerSettings: "manage_settings",
  inventory: "manage_stock",
  suppliers: "manage_stock",
  addProduct: "add_product",
  openingStock: "all",
  help: null,
  home: null,
  logout: null,
  categorySettings: "all",
  taxSettings: "manage_settings",
  stock: "manage_stock",
  products: "add_product",
  reports: "view_reports",
  // This is an explicitly non-operational UI prototype. It uses the same
  // inventory access boundary as the screens it prepares staff to use.
  stocktakingPrototype: "manage_stock",
  receiptDeliveryPrototype: "create_sale",
  staff: "manage_users"
};

export const getPagePermission = (page) => {
  return pagePermissions[page] ?? null;
};
