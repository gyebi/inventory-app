// A null profit is meaningful: opening/provisional sales have no verified
// cost, so treating it as zero would incorrectly report full margin.
export function getReportSaleProfit(sale) {
  if (sale?.costStatus === "unknown" || sale?.profit === null || sale?.totalProfit === null) return null;
  const value = sale?.profit ?? sale?.totalProfit ?? 0;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
