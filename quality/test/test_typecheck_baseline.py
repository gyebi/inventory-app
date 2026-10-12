import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "check-typecheck-baseline.py"
SPEC = importlib.util.spec_from_file_location("typecheck_baseline", SCRIPT)
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


def diagnostic(message="Property 'legacy' does not exist."):
    return {"file": "js/app.js", "code": "TS2339", "message": message}


class TypecheckBaselineTests(unittest.TestCase):
    def compare(self, baseline, current):
        return CHECKER.compare_diagnostics(baseline, current)[2:]

    def test_absolute_project_paths_match_across_checkouts(self):
        baseline = [diagnostic("File '/home/dev/Documents/inventory-app/js/pages/inventory.js' is not a module.")]
        current = [diagnostic("File '/home/runner/work/inventory-app/inventory-app/js/pages/inventory.js' is not a module.")]
        introduced, resolved = self.compare(baseline, current)
        self.assertFalse(introduced)
        self.assertFalse(resolved)

    def test_new_diagnostic_is_detected(self):
        introduced, resolved = self.compare([diagnostic()], [diagnostic(), diagnostic("New error")])
        self.assertEqual(sum(introduced.values()), 1)
        self.assertFalse(resolved)

    def test_extra_occurrence_of_existing_diagnostic_is_detected(self):
        introduced, resolved = self.compare([diagnostic()], [diagnostic(), diagnostic()])
        self.assertEqual(sum(introduced.values()), 1)
        self.assertFalse(resolved)

    def test_resolved_diagnostic_is_allowed(self):
        introduced, resolved = self.compare([diagnostic(), diagnostic("Resolved error")], [diagnostic()])
        self.assertFalse(introduced)
        self.assertEqual(sum(resolved.values()), 1)

    def test_unexpected_compiler_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unexpected TypeScript output"):
            CHECKER.parse_typecheck_output("error TS5058: The specified path does not exist.")


if __name__ == "__main__":
    unittest.main()
