
function getLineWidth(paperWidthMm) {
  return Number(paperWidthMm) >= 80 ? 48 : 32;
}

function cleanText(value, maxLength = 100) {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function money(value) {
  return `GHS ${(Number(value) || 0).toFixed(2)}`;
}

function center(text, lineWidth) {
  const value = cleanText(text, lineWidth || getLineWidth());
  const width = lineWidth || getLineWidth();

  if (value.length >= width) {
    return value;
  }

  const spaces = Math.floor((width - value.length) / 2);

  return " ".repeat(spaces) + value;
}

function leftRight(left, right, lineWidth) {
  const width = lineWidth || getLineWidth();
  left = cleanText(left, width);
  right = cleanText(right, width);

  const availableLeft = Math.max(
    1,
    width - right.length - 1
  );

  if (left.length > availableLeft) {
    left = left.slice(0, availableLeft);
  }

  const spaces = Math.max(
    1,
    width - left.length - right.length
  );

  return left + " ".repeat(spaces) + right;
}

function buildReceipt(receipt) {
  const lines = [];
  const lineWidth = getLineWidth(receipt.paperWidthMm);

  lines.push(
    center(receipt.businessName || "CALKRIS-DARF VENTURES", lineWidth)
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
  lines.push(cleanText(receipt.receiptId, lineWidth));

  lines.push(
    leftRight("Date:", cleanText(receipt.date, 20), lineWidth)
  );

  lines.push(
    leftRight("Cashier:", cleanText(receipt.cashier, 18), lineWidth)
  );

  lines.push("-".repeat(lineWidth));

  const items = Array.isArray(receipt.items)
    ? receipt.items.slice(0, 100)
    : [];

  for (const item of items) {
    lines.push(
      cleanText(item.name || "Item", lineWidth)
    );

    const quantity = Number(item.quantity) || 0;
    const unit = cleanText(item.unit, 8);
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
