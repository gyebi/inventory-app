const NORMALIZED_TEXT_COLLATOR = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
  usage: "sort"
});

const ORIGINAL_TEXT_COLLATOR = new Intl.Collator("en", {
  sensitivity: "variant",
  numeric: true,
  usage: "sort"
});

const rawText = (value) => value === null || value === undefined ? "" : String(value);

export const normalizePresentationText = (value) => rawText(value).trim().normalize("NFKC");

export function comparePresentationText(left, right) {
  const normalizedLeft = normalizePresentationText(left);
  const normalizedRight = normalizePresentationText(right);

  if (!normalizedLeft && normalizedRight) return 1;
  if (normalizedLeft && !normalizedRight) return -1;

  const normalizedComparison = NORMALIZED_TEXT_COLLATOR.compare(normalizedLeft, normalizedRight);

  if (normalizedComparison !== 0) return normalizedComparison;

  return ORIGINAL_TEXT_COLLATOR.compare(rawText(left), rawText(right));
}

export function compareProductsForPresentation(left = {}, right = {}) {
  const nameComparison = comparePresentationText(left?.name, right?.name);

  if (nameComparison !== 0) return nameComparison;

  return NORMALIZED_TEXT_COLLATOR.compare(rawText(left?.id), rawText(right?.id));
}

export function sortProductsForPresentation(products = []) {
  return Array.isArray(products) ? [...products].sort(compareProductsForPresentation) : [];
}

export function sortPresentationValues(values = []) {
  if (!Array.isArray(values)) return [];

  return values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => comparePresentationText(left.value, right.value) || left.index - right.index)
    .map(({ value }) => value);
}
