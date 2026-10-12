import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";
import {
  collectDiagnostics,
  compareDiagnostics,
  validateBaseline
} from "./eslint-baseline-lib.mjs";

const root = process.cwd();
const baselinePath = path.join(root, "quality/baselines/eslint.json");

const baseline = JSON.parse(
  fs.readFileSync(baselinePath, "utf8")
);

validateBaseline(baseline);

let current;
try {
  const eslint = new ESLint();
  const results = await eslint.lintFiles([
    "js/**/*.js",
    "functions/index.js",
    "printer-bridge/**/*.js"
  ]);
  current = collectDiagnostics(results, root);
} catch (error) {
  console.error(`FAIL: ESLint could not complete safely: ${error.message}`);
  process.exit(1);
}

const { oldCounts, newCounts, introduced, resolved } = compareDiagnostics(
  baseline.diagnostics,
  current
);
const introducedCount = [...introduced.values()].reduce((sum, count) => sum + count, 0);
const resolvedCount = [...resolved.values()].reduce((sum, count) => sum + count, 0);

for (const [key, count] of introduced) {
  console.error(`NEW x${count}: ${key}`);
}

console.log(`Baseline lint findings: ${baseline.diagnostics.length}`);
console.log(`Current lint findings:  ${current.length}`);
console.log(`Resolved findings:      ${resolvedCount}`);
console.log(`New findings:           ${introducedCount}`);

if (introducedCount > 0) {
  console.error("\nFAIL: New ESLint violations detected.");
  process.exit(1);
}

console.log("\nPASS: No new ESLint violations.");
