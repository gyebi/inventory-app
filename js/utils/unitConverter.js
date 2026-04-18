export const toBaseUnit = (product, quantity, unit) => {
  if (!product) {
    throw new Error("Product is required");
  }

  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be a valid number");
  }

  if (unit === "base" || unit === product.baseUnit) {
    return quantity;
  }

  if (unit === "bulk" || unit === product.bulkUnit) {
    if (!Number.isInteger(product.unitsPerBulk) || product.unitsPerBulk <= 0) {
      throw new Error(`Invalid units per bulk for ${product.name}`);
    }

    return quantity * product.unitsPerBulk;
  }

  throw new Error(`Invalid unit: ${unit}`);
};

export const fromBaseUnit = (product, quantity, unit) => {
  if (!product) {
    throw new Error("Product is required");
  }

  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be a valid number");
  }

  if (unit === "base" || unit === product.baseUnit) {
    return quantity;
  }

  if (unit === "bulk" || unit === product.bulkUnit) {
    if (!Number.isInteger(product.unitsPerBulk) || product.unitsPerBulk <= 0) {
      throw new Error(`Invalid units per bulk for ${product.name}`);
    }

    return quantity / product.unitsPerBulk;
  }

  throw new Error(`Invalid unit: ${unit}`);
};

export const getDisplayUnit = (product, unit) => {
  if (!product) {
    throw new Error("Product is required");
  }

  if (unit === "base" || unit === product.baseUnit) {
    return product.baseUnit;
  }

  if (unit === "bulk" || unit === product.bulkUnit) {
    return product.bulkUnit;
  }

  throw new Error(`Invalid unit: ${unit}`);
};
