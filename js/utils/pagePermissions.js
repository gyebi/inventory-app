export const pagePermissions = {
  dashboard: "view_dashboard",
  sales: "create_sale",
  receiveStock: "manage_stock",
  inventory: "manage_stock",
  suppliers: "manage_stock",
  addProduct: "add_product",
  help: null,
  home: null,
  logout: null,
  stock: "manage_stock",
  products: "add_product",
  reports: "view_reports",
  staff: "manage_users"
};

export const getPagePermission = (page) => {
  return pagePermissions[page] ?? null;
};
