import path from "node:path";

export function validateBaseline(baseline) {
  if (baseline?.version !== 1 || !Array.isArray(baseline.diagnostics)) {
    throw new Error("Invalid ESLint baseline");
  }

  for (const item of baseline.diagnostics) {
    if (
      !item ||
      typeof item.file !== "string" ||
      typeof item.ruleId !== "string" ||
      typeof item.severity !== "number" ||
      typeof item.message !== "string"
    ) {
      throw new Error("Malformed ESLint baseline diagnostic");
    }
  }
}

export function fingerprint(item) {
  return JSON.stringify([item.file, item.ruleId, item.severity, item.message]);
}

export function countDiagnostics(items) {
  const counts = new Map();
  for (const item of items) {
    const key = fingerprint(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function collectDiagnostics(results, root) {
  const diagnostics = [];
  for (const result of results) {
    if (result.fatalErrorCount > 0) {
      throw new Error(`ESLint reported fatal errors in ${path.relative(root, result.filePath)}`);
    }
    for (const message of result.messages) {
      if (message.fatal || !message.ruleId) {
        throw new Error(
          `ESLint reported an unbaselineable fatal/configuration error in ${path.relative(root, result.filePath)}: ${message.message}`
        );
      }
      diagnostics.push({
        file: path.relative(root, result.filePath).replace(/\\/g, "/"),
        ruleId: message.ruleId,
        severity: message.severity,
        message: message.message
      });
    }
  }
  return diagnostics;
}

export function compareDiagnostics(baselineDiagnostics, currentDiagnostics) {
  const oldCounts = countDiagnostics(baselineDiagnostics);
  const newCounts = countDiagnostics(currentDiagnostics);
  const introduced = new Map();
  const resolved = new Map();

  for (const [key, count] of newCounts) {
    const difference = count - (oldCounts.get(key) ?? 0);
    if (difference > 0) introduced.set(key, difference);
  }
  for (const [key, count] of oldCounts) {
    const difference = count - (newCounts.get(key) ?? 0);
    if (difference > 0) resolved.set(key, difference);
  }
  return { oldCounts, newCounts, introduced, resolved };
}
