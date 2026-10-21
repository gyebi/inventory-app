const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  createWindowsBluetoothPrinter,
} = require("../adapters/windowsBluetoothPrinter");

const config = { portName: "COM3", baudRate: 9600 };

function print(adapter, text = "Test receipt") {
  return new Promise((resolve, reject) => {
    adapter.print(text, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

test("rejects unsupported platforms and invalid ports before launching", async () => {
  const neverRun = () => assert.fail("PowerShell must not run");
  await assert.rejects(
    print(createWindowsBluetoothPrinter(config, {
      platform: "linux", execFile: neverRun,
    })),
    { code: "unsupported-platform" }
  );
  await assert.rejects(
    print(createWindowsBluetoothPrinter({ portName: "COM3;bad" }, {
      platform: "win32", execFile: neverRun,
    })),
    { code: "printer-not-configured" }
  );
});

test("sanitizes receipt bytes, bounds execution and removes temporary files", async () => {
  let receiptPath;
  const adapter = createWindowsBluetoothPrinter(config, {
    platform: "win32",
    execFile(command, args, options, callback) {
      assert.equal(command, "powershell.exe");
      assert.equal(args[args.indexOf("-PortName") + 1], "COM3");
      assert.equal(options.timeout, 20000);
      assert.equal(options.maxBuffer, 65536);
      receiptPath = args[args.indexOf("-FilePath") + 1];
      const bytes = fs.readFileSync(receiptPath);
      assert.deepEqual([...bytes.subarray(0, 2)], [27, 64]);
      assert.equal(
        bytes.subarray(2).toString("ascii"),
        "Water@ total 9.00\n\n\n"
      );
      callback(null, 'JYAANO_PRINT_JOB={"submitted":true}', "");
    },
  });
  const result = await print(adapter, "Water\u001b@ total 9.00\n\n");
  assert.equal(result.submitted, true);
  assert.equal(result.physicalPrintConfirmed, false);
  assert.equal(fs.existsSync(receiptPath), false);
});

test("interrupted submission is uncertain and is never retried", async () => {
  let calls = 0;
  const adapter = createWindowsBluetoothPrinter(config, {
    platform: "win32",
    execFile(command, args, options, callback) {
      calls += 1;
      callback(Object.assign(new Error("Timed out"), { killed: true }), "", "");
    },
  });
  await assert.rejects(print(adapter), { code: "print-result-unknown" });
  assert.equal(calls, 1);
});
