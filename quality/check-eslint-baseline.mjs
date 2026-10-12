import { ESLint } from "eslint";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const baselinePath = path.join(root, "quality/baselines/eslint.json");

const baseline = JSON.parse(
  fs.readFileSync(baselinePath, "utf8")
);

if (baseline.version !== 1 || !Array.isArray(baseline.diagnostics)) {
  throw new Error("Invalid ESLint baseline");
}

function fingerprint(item) {
  return JSON.stringify([
    item.file,
    item.ruleId,
    item.severity,
    item.message
  ]);
}

function countDiagnostics(items) {
  const counts = new Map();

  for (const item of items) {
    const key = fingerprint(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

const eslint = new ESLint();

const results = await eslint.lintFiles([
  "js/**/*.js",
  "functions/index.js",
  "printer-bridge/**/*.js"
]);

const current = results.flatMap(file =>
  file.messages.map(message => ({
    file: path.relative(root, file.filePath).replace(/\\/g, "/"),
    ruleId: message.ruleId,
    severity: message.severity,
    message: message.message
  }))
);

const oldCounts = countDiagnostics(baseline.diagnostics);
const newCounts = countDiagnostics(current);

let introduced = 0;
let resolved = 0;

for (const [key, count] of newCounts) {
  const difference = count - (oldCounts.get(key) ?? 0);

  if (difference > 0) {
    introduced += difference;
    console.error(
      `NEW x${difference}: ${key}`
    );
  }
}

for (const [key, count] of oldCounts) {
  const difference = count - (newCounts.get(key) ?? 0);

  if (difference > 0) {
    resolved += difference;
  }
}

console.log(`Baseline lint findings: ${baseline.diagnostics.length}`);
console.log(`Current lint findings:  ${current.length}`);
console.log(`Resolved findings:      ${resolved}`);
console.log(`New findings:           ${introduced}`);

if (introduced > 0) {
  console.error("\nFAIL: New ESLint violations detected.");
  process.exit(1);
}

console.log("\nPASS: No new ESLint violations.");
