
const {
  createLinuxRfcommPrinter,
} = require("./linuxRfcommPrinter");

const {
  createWindowsUsbPrinter,
} = require("./windowsUsbPrinter");

const {
  createWindowsBluetoothPrinter,
} = require("./windowsBluetoothPrinter");

function createPrinter(config, options = {}) {
  switch (config.type) {
    case "linux-rfcomm":
      return createLinuxRfcommPrinter(config);

    case "windows-bluetooth":
      return createWindowsBluetoothPrinter(config, options);

    case "windows-usb":
      return createWindowsUsbPrinter(config, options);

    default:
      throw new Error(
        `Unsupported printer type: ${config.type}`
      );
  }
}

module.exports = {
  createPrinter,
};
