import { saveCategorySettingsToCloud, normalizeCategories } from "../services/categorySettingsService.js";

const { renderPage, saveState, state } = window.app;

function getCategoryValues() {
  const categories = Array.isArray(state.settings?.categories) && state.settings.categories.length > 0
    ? state.settings.categories
    : ["Water", "Soft Drink", "Juice", "Energy Drink"];

  return categories;
}

function renderCategorySettings(error = "", values = getCategoryValues()) {
  renderPage(`
    <div class="page-title">
      <h2>Product Categories</h2>
      <p>Manage the shared category list used when adding new products.</p>
    </div>

    ${error ? `<div class="message error">${error}</div>` : ""}

    <div class="form-column panel">
      <div class="form-row">
        <label for="categoryInput">Add Category</label>
        <input id="categoryInput" placeholder="e.g. Milk">
      </div>

      <button type="button" onclick="addCategory()">Add Category</button>

      <div class="card">
        <strong>Current Categories</strong>
        <div class="category-list">
          ${values.map((category) => `
            <div class="category-item">
              <span>${escapeHtml(category)}</span>
              <button type="button" onclick="removeCategory('${escapeJs(category)}')">Remove</button>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="form-row">
        <label for="categorySeed">Quick Replace List</label>
        <textarea id="categorySeed" rows="5" placeholder="One category per line">${escapeHtml(values.join("\n"))}</textarea>
      </div>

      <button type="button" onclick="saveCategoryList()">Save Category List</button>
      <button type="button" onclick="navigate('home')">Back to Menu</button>
    </div>
  `);
}

async function addCategory() {
  const input = document.getElementById("categoryInput");
  const nextCategory = input?.value.trim();
  const current = getCategoryValues();

  if (!nextCategory) {
    renderCategorySettings("Enter a category name before adding it.", current);
    return;
  }

  const updated = normalizeCategories([...current, nextCategory]);
  state.settings = {
    ...(state.settings || {}),
    categories: updated
  };

  try {
    await saveCategorySettingsToCloud(updated);
    saveState();
    renderCategorySettings("Category added successfully.", updated);
  } catch (error) {
    renderCategorySettings(error.message || "Unable to add category.");
  }
}

async function removeCategory(categoryName) {
  const current = getCategoryValues();
  const updated = current.filter((category) => category !== categoryName);

  state.settings = {
    ...(state.settings || {}),
    categories: updated.length > 0 ? updated : ["Water", "Soft Drink", "Juice", "Energy Drink"]
  };

  try {
    await saveCategorySettingsToCloud(state.settings.categories);
    saveState();
    renderCategorySettings("Category removed successfully.", getCategoryValues());
  } catch (error) {
    renderCategorySettings(error.message || "Unable to remove category.");
  }
}

async function saveCategoryList() {
  const seed = document.getElementById("categorySeed")?.value || "";
  const categories = normalizeCategories(seed.split(/\r?\n/));

  if (categories.length === 0) {
    renderCategorySettings("Add at least one category before saving.");
    return;
  }

  state.settings = {
    ...(state.settings || {}),
    categories
  };

  try {
    await saveCategorySettingsToCloud(categories);
    saveState();
    renderCategorySettings("Category list saved successfully.", categories);
  } catch (error) {
    renderCategorySettings(error.message || "Unable to save category list.");
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

window.renderCategorySettings = renderCategorySettings;
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.saveCategoryList = saveCategoryList;
