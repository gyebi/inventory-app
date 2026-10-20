import { generateReceiptText } from "./receiptService.js";

export const ANDROID_RAWBT_OUTPUT_MODE = "android-rawbt";
const LINE_WIDTH = 32;
const MAX_INTENT_LENGTH = 16000;

function cleanField(value) {
  const text = String(value ?? "");
  if (text.length > 2000) {
    throw new Error("A receipt field is too long to print safely.");
  }
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/[^\x20-\x7e]/g, "?")
    .trim();
}

function wrapLine(line) {
  const words = line.trim().split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (word.length > LINE_WIDTH) {
      if (current) lines.push(current);
      current = "";
      for (let i = 0; i < word.length; i += LINE_WIDTH) {
        lines.push(word.slice(i, i + LINE_WIDTH));
      }
    } else if (!current) {
      current = word;
    } else if (current.length + word.length + 1 <= LINE_WIDTH) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

export function buildAndroidRawBtIntent(sale) {
  if (!sale || !cleanField(sale.id) || sale.committed === false ||
      !Array.isArray(sale.items) ||
      sale.items.length < 1 || sale.items.length > 100) {
    throw new Error("Open a saved sale before printing its receipt.");
  }

  function amount(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error("The receipt contains an invalid amount.");
    }
    return value;
  }

  amount(sale.totalAmount);
  for (const value of Object.values(sale.taxBreakdown || {})) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("The receipt contains an invalid tax value.");
    }
  }

  const safeSale = {
    ...sale,
    id: cleanField(sale.id),
    createdAt: cleanField(sale.createdAt),
    user: cleanField(sale.user),
    createdBy: sale.createdBy ? {
      ...sale.createdBy,
      fullName: cleanField(sale.createdBy.fullName),
      username: cleanField(sale.createdBy.username)
    } : undefined,
    items: sale.items.map((item) => {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
        throw new Error("The receipt contains an invalid quantity.");
      }
      return {
        ...item,
        name: cleanField(item.name),
        unit: cleanField(item.unit),
        unitLabel: cleanField(item.unitLabel),
        unitPrice: amount(item.unitPrice),
        total: amount(item.total)
      };
    })
  };

  const text = generateReceiptText(safeSale)
    .replace(/\r/g, "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?")
    .split("\n")
    .map(wrapLine)
    .join("\n")
    .trimEnd();

  // Initialize the printer, print text, then feed just three line breaks.
  const payload = "\x1b\x40" + text + "\n\n\n";
  const intent = "intent:base64," + btoa(payload) +
    "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";

  if (intent.length > MAX_INTENT_LENGTH) {
    throw new Error(
      "This receipt is too large for direct Android printing. Use another print method."
    );
  }
  return intent;
}

export function printAndroidRawBtReceipt(sale) {
  if (!/Android/i.test(globalThis.navigator?.userAgent || "")) {
    throw new Error("Android / RawBT printing requires an Android device.");
  }

  const intent = buildAndroidRawBtIntent(sale);
  globalThis.location.href = intent;

  // Launching RawBT cannot confirm that paper physically printed.
  return { status: "handoff-requested" };
}
