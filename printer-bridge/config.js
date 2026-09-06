
module.exports = {
  port: 17820,

  printer: {
    type: "linux-rfcomm",
    name: "MPT-II",
    device: "/dev/rfcomm0",
    paperWidthMm: 58,
  },
};


//when using an Xprinter
/*
module.exports = {
  port: 17820,

  printer: {
    type: "windows-usb",
    name: "Xprinter",
    printerName: "XP-80C",
    paperWidthMm: 80,
  },
};

*/
