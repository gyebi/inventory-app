#!/usr/bin/env python3
"""Reject TypeScript diagnostics that are not part of the accepted legacy baseline."""

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "quality/baselines/typescript.json"
DIAGNOSTIC_PATTERN = re.compile(r"^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$")
ABSOLUTE_PROJECT_PATH_PATTERN = re.compile(
    r"(^|(?<=[\"'`(]))(?:[A-Za-z]:)?/(?:[^\s\"'`)/]+/)*(js/[^\s\"'`)]*)"
)


def normalize_project_path(value):
    """Convert an absolute path ending in js/... to its repository-relative form.

    TypeScript embeds source paths in a few diagnostic messages. Only paths whose
    preserved suffix is the repository's JavaScript source tree are changed.
    """
    normalized = value.replace("\\", "/")
    return ABSOLUTE_PROJECT_PATH_PATTERN.sub(lambda match: match.group(2), normalized)


def fingerprint(item):
    return (
        normalize_project_path(item["file"]),
        item["code"],
        normalize_project_path(item["message"]),
    )


def validate_baseline(baseline):
    if baseline.get("version") != 1 or not isinstance(baseline.get("diagnostics"), list):
        raise ValueError("Unsupported or malformed TypeScript baseline")
    for item in baseline["diagnostics"]:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(field), str) for field in ("file", "code", "message")
        ):
            raise ValueError("Malformed TypeScript baseline diagnostic")


def parse_typecheck_output(output):
    """Parse plain TypeScript diagnostics and reject unexpected compiler output."""
    current = []
    unrecognized = []
    for line in output.splitlines():
        match = DIAGNOSTIC_PATTERN.match(line)
        if match:
            filename, line_no, column, code, message = match.groups()
            current.append({
                "file": filename,
                "line": int(line_no),
                "column": int(column),
                "code": code,
                "message": message,
            })
        elif line.strip():
            unrecognized.append(line)
    if unrecognized:
        raise ValueError("Unexpected TypeScript output: " + " | ".join(unrecognized))
    return current


def compare_diagnostics(baseline_diagnostics, current_diagnostics):
    old_counts = Counter(fingerprint(item) for item in baseline_diagnostics)
    new_counts = Counter(fingerprint(item) for item in current_diagnostics)
    return old_counts, new_counts, new_counts - old_counts, old_counts - new_counts


def run_typecheck():
    try:
        return subprocess.run(
            ["npx", "--no-install", "tsc", "--project", "jsconfig.check.json",
             "--noEmit", "--pretty", "false"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        raise RuntimeError(f"Could not execute TypeScript: {error}") from error


def main():
    try:
        baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
        validate_baseline(baseline)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"TypeScript baseline is invalid: {error}", file=sys.stderr)
        return 1
    try:
        result = run_typecheck()
        output = result.stdout + result.stderr
        current = parse_typecheck_output(output)
    except (RuntimeError, ValueError) as error:
        print(f"TypeScript produced unexpected output: {error}", file=sys.stderr)
        return 1

    if result.returncode not in (0, 1):
        print(f"TypeScript failed with exit code {result.returncode}:\n{output}", file=sys.stderr)
        return 1
    if result.returncode == 0 and current:
        print("TypeScript reported diagnostics but exited successfully.", file=sys.stderr)
        return 1
    if result.returncode != 0 and not current:
        print(f"TypeScript failed without recognized diagnostics:\n{output}", file=sys.stderr)
        return 1

    old_counts, new_counts, introduced, resolved = compare_diagnostics(
        baseline["diagnostics"], current
    )
    print(f"Baseline errors: {sum(old_counts.values())}")
    print(f"Current errors:  {sum(new_counts.values())}")
    print(f"Resolved errors: {sum(resolved.values())}")
    print(f"New errors:      {sum(introduced.values())}")
    if introduced:
        print("\nNew TypeScript diagnostics:", file=sys.stderr)
        for (filename, code, message), count in sorted(introduced.items()):
            print(f"  {filename} [{code}] x{count}: {message}", file=sys.stderr)
        return 1
    print("\nPASS: No new TypeScript errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
