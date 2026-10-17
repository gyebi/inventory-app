
function getLineWidth(paperWidthMm) {
  return Number(paperWidthMm) >= 80 ? 48 : 32;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .trim();
}

function wrapText(value, lineWidth) {
  const text = cleanText(value);
  const width = Math.max(1, Number(lineWidth) || getLineWidth());

  if (!text) return [""];

  const lines = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    if (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }

    if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function money(value) {
  return `GHS ${(Number(value) || 0).toFixed(2)}`;
}

function center(text, lineWidth) {
  const width = lineWidth || getLineWidth();
  return wrapText(text, width)
    .map((value) => " ".repeat(Math.floor((width - value.length) / 2)) + value)
    .join("\n");
}

function leftRight(left, right, lineWidth) {
  const width = lineWidth || getLineWidth();
  const rightText = cleanText(right);

  if (rightText.length > width - 2) {
    return [...wrapText(left, width), ...wrapText(rightText, width)].join("\n");
  }

  const availableLeft = Math.max(1, width - rightText.length - 1);
  const leftLines = wrapText(left, availableLeft);
  const finalLeft = leftLines.pop() || "";
  const spaces = Math.max(1, width - finalLeft.length - rightText.length);

  return [...leftLines, finalLeft + " ".repeat(spaces) + rightText].join("\n");
}

function buildReceipt(receipt) {
  const lines = [];
  const lineWidth = getLineWidth(receipt.paperWidthMm);

  lines.push(
    center(receipt.businessName || "Kay-Flo Enterprise", lineWidth)
  );

  if (receipt.businessAddress) {
    lines.push(center(receipt.businessAddress, lineWidth));
  }

  if (receipt.businessPhone) {
    lines.push(center(`Tel: ${receipt.businessPhone}`, lineWidth));
  }

  if (receipt.businessEmail) {
    lines.push(center(receipt.businessEmail, lineWidth));
  }

  lines.push(center("SALES RECEIPT", lineWidth));
  lines.push("-".repeat(lineWidth));

  lines.push("Receipt:");
  lines.push(...wrapText(receipt.receiptId, lineWidth));

  lines.push(
    leftRight("Date:", receipt.date, lineWidth)
  );

  lines.push(
    leftRight("Cashier:", receipt.cashier, lineWidth)
  );

  lines.push("-".repeat(lineWidth));

  const items = Array.isArray(receipt.items)
    ? receipt.items.slice(0, 100)
    : [];

  for (const item of items) {
    lines.push(
      ...wrapText(item.name || "Item", lineWidth)
    );

    const quantity = Number(item.quantity) || 0;
    const unit = cleanText(item.unit);
    const unitPrice = Number(item.unitPrice) || 0;
    const total = Number(item.total) || 0;

    lines.push(
      leftRight(
        `${quantity} ${unit} x ${unitPrice.toFixed(2)}`,
        money(total),
        lineWidth
      )
    );
  }

  lines.push("-".repeat(lineWidth));

  if (receipt.tax?.enabled) {
    lines.push(
      leftRight(
        "Subtotal",
        money(receipt.tax.subtotal),
        lineWidth
      )
    );

    if (Number(receipt.tax.nhilAmount) > 0) {
      lines.push(
        leftRight(
          `NHIL ${Number(receipt.tax.nhilRate || 0).toFixed(1)}%`,
          money(receipt.tax.nhilAmount),
          lineWidth
        )
      );
    }

    if (Number(receipt.tax.getfundAmount) > 0) {
      lines.push(
        leftRight(
          `GETFund ${Number(receipt.tax.getfundRate || 0).toFixed(1)}%`,
          money(receipt.tax.getfundAmount),
          lineWidth
        )
      );
    }

    if (Number(receipt.tax.vatAmount) > 0) {
      lines.push(
        leftRight(
          `VAT ${Number(receipt.tax.vatRate || 0).toFixed(1)}%`,
          money(receipt.tax.vatAmount),
          lineWidth
        )
      );
    }
  }

  lines.push("=".repeat(lineWidth));

  lines.push(
    leftRight(
      "TOTAL",
      money(receipt.totalAmount),
      lineWidth
    )
  );

  lines.push("=".repeat(lineWidth));
  lines.push("");
  lines.push(center("Thank you for your business.", lineWidth));
  lines.push("");
  lines.push("");
  lines.push("");

  return lines.join("\n");
}

module.exports = {
  buildReceipt,
};
