import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDiagnostics,
  compareDiagnostics
} from "../eslint-baseline-lib.mjs";

const legacy = {
  file: "js/legacy.js",
  ruleId: "no-unused-vars",
  severity: 2,
  message: "'legacy' is assigned a value but never used."
};

test("accepts an unchanged legacy ESLint finding", () => {
  const { introduced, resolved } = compareDiagnostics([legacy], [legacy]);
  assert.equal(introduced.size, 0);
  assert.equal(resolved.size, 0);
});

test("rejects a new ESLint finding", () => {
  const { introduced } = compareDiagnostics([legacy], [legacy, { ...legacy, ruleId: "no-undef" }]);
  assert.equal([...introduced.values()][0], 1);
});

test("counts duplicate ESLint findings", () => {
  const { introduced } = compareDiagnostics([legacy], [legacy, legacy]);
  assert.equal([...introduced.values()][0], 1);
});

test("allows resolved ESLint findings", () => {
  const { introduced, resolved } = compareDiagnostics([legacy, { ...legacy, message: "resolved" }], [legacy]);
  assert.equal(introduced.size, 0);
  assert.equal([...resolved.values()][0], 1);
});

test("rejects fatal ESLint output instead of baselining it", () => {
  assert.throws(
    () => collectDiagnostics([{
      filePath: "/repo/js/broken.js",
      fatalErrorCount: 1,
      messages: [{ fatal: true, ruleId: null, message: "Parsing error" }]
    }], "/repo"),
    /fatal errors/
  );
});
