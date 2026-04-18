export const generateReceiptText = (sale) => {
  let lines = [];

  lines.push("CALKRIS-DARF VENTURES");
  lines.push("----------------------------");

  sale.items.forEach(item => {
    lines.push(
      `${item.name} x${item.quantity} @ ${item.unitPrice} = ${item.total}`
    );
  });

  lines.push("----------------------------");
  lines.push(`TOTAL: ${sale.totalAmount}`);
  lines.push(`DATE: ${new Date(sale.createdAt).toLocaleString()}`);
  lines.push(`RECEIPT ID: ${sale.id}`);
  lines.push(`SERVED BY: ${sale.user}`);

  return lines.join("\n");
};