const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverWindowsSerialPorts,
  parseSerialPorts,
} = require("../services/windowsSerialDiscovery");

test("COM discovery validates, deduplicates and numerically sorts ports", () => {
  const ports = parseSerialPorts(
    '["COM10","com3","COM3","COM4","COM0","COM3;bad",null]'
  );
  assert.deepEqual(ports.map((port) => port.portName), ["COM3", "COM4", "COM10"]);
  assert.ok(ports.every((port) => port.direction === "unknown"));
  assert.deepEqual(parseSerialPorts("[]"), []);
  assert.equal(parseSerialPorts('"COM3"')[0].portName, "COM3");
});

test("COM discovery does not launch PowerShell on Linux", async () => {
  assert.deepEqual(await discoverWindowsSerialPorts({
    platform: "linux",
    execFile() { assert.fail("Must not launch"); },
  }), []);
});

test("COM discovery bounds the subprocess and handles failures", async () => {
  await assert.rejects(discoverWindowsSerialPorts({
    platform: "win32",
    execFile(command, args, options, callback) {
      assert.equal(command, "powershell.exe");
      assert.equal(options.timeout, 5000);
      assert.equal(options.maxBuffer, 16384);
      callback(new Error("Timeout"));
    },
  }), { code: "printer-discovery-failed" });
});
