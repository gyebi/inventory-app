#!/usr/bin/env python3

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "quality/baselines/typescript.json"

PATTERN = re.compile(
    r"^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$"
)

def fingerprint(item):
    message = item["message"].replace("\\", "/")

    # Normalize machine-specific absolute paths inside diagnostics.
    message = re.sub(
        r"(?<![\\w./-])(?:/[^\\s'\\\"`]+)*/js/",
        "js/",
        message
    )

    return (
        item["file"].replace("\\", "/"),
        item["code"],
        message
    )

baseline = json.loads(BASELINE.read_text())

if baseline.get("version") != 1:
    sys.exit("Unsupported TypeScript baseline version")

result = subprocess.run(
    [
        "npx", "--no-install", "tsc",
        "--project", "jsconfig.check.json",
        "--noEmit", "--pretty", "false"
    ],
    cwd=ROOT,
    capture_output=True,
    text=True
)

output = result.stdout + result.stderr
current = []
unrecognized = []

for line in output.splitlines():
    match = PATTERN.match(line)

    if match:
        filename, line_no, column, code, message = match.groups()
        current.append({
            "file": filename,
            "line": int(line_no),
            "column": int(column),
            "code": code,
            "message": message
        })
    elif line.strip():
        unrecognized.append(line)

if result.returncode not in (0, 1) or unrecognized:
    print("TypeScript produced unexpected output:")
    print(output)
    sys.exit(1)

if result.returncode != 0 and not current:
    print("TypeScript failed without recognized diagnostics:")
    print(output)
    sys.exit(1)

old_counts = Counter(
    fingerprint(item) for item in baseline["diagnostics"]
)

new_counts = Counter(
    fingerprint(item) for item in current
)

introduced = new_counts - old_counts
resolved = old_counts - new_counts

print(f"Baseline errors: {sum(old_counts.values())}")
print(f"Current errors:  {sum(new_counts.values())}")
print(f"Resolved errors: {sum(resolved.values())}")
print(f"New errors:      {sum(introduced.values())}")

if introduced:
    print("\nNew TypeScript diagnostics:")
    for (filename, code, message), count in sorted(introduced.items()):
        print(f"  {filename} [{code}] x{count}: {message}")

    sys.exit(1)

print("\nPASS: No new TypeScript errors.")
