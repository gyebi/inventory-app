
const fs = require("fs");

function createLinuxRfcommPrinter(config) {
  return {
    getStatus() {
      const available = fs.existsSync(config.device);

      return {
        type: "linux-rfcomm",
        name: config.name,
        displayName: config.displayName || config.name,
        device: config.device,
        paperWidthMm: Number(config.paperWidthMm || 58),
        ready: available,
      };
    },

    print(text, callback) {
      if (!fs.existsSync(config.device)) {
        return callback(
          new Error(
            `Printer device not available: ${config.device}`
          )
        );
      }

      const initializePrinter = Buffer.from([0x1b, 0x40]);
      const receiptBytes = Buffer.from(text, "ascii");

      const output = Buffer.concat([
        initializePrinter,
        receiptBytes,
      ]);

      fs.writeFile(config.device, output, callback);
    },
  };
}

module.exports = {
  createLinuxRfcommPrinter,
};
