// Server-only helpers for parsing uploaded documents into plain text.
// Used by analyzeDocument and the assumption extraction engine.

export async function pdfBufferToText(buf: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text ?? "");
}

export async function xlsxBufferToText(buf: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    out.push(`# Sheet: ${name}`);
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
    const headers = (rows[0] ?? []).map((cell) => String(cell ?? "").trim().toLowerCase());
    rows.forEach((row, index) => {
      out.push(`${index + 1}: ${row.map((cell, columnIndex) => formatSpreadsheetCell(cell, headers[columnIndex], row)).join(" | ")}`);
    });
  }
  return out.join("\n");
}

function formatSpreadsheetCell(cell: unknown, header: string | undefined, row: unknown[]): string {
  if (cell == null) return "";
  if (typeof cell !== "number" || !isFinite(cell)) return String(cell).trim();

  const rowLabel = row
    .slice(0, 2)
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  const financialContext = [
    header ?? "",
    rowLabel,
  ].join(" ");

  const looksLikeMoney =
    /\b(amount|budget|cost|price|value|loan|equity|debt|proceeds|income|revenue|rent|noi|opex|expense|tdc|total|contingency|financing)\b/.test(financialContext) &&
    Math.abs(cell) >= 1000;

  const formatted = Math.round(cell) === cell ? String(cell) : String(cell);
  return looksLikeMoney ? `$${formatted}` : formatted;
}

export async function extractFileText(name: string, fileType: string | null | undefined, buf: ArrayBuffer): Promise<string> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || fileType?.includes("pdf")) return pdfBufferToText(buf);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || fileType?.includes("sheet")) return xlsxBufferToText(buf);
  // Plain text fallback
  return new TextDecoder().decode(buf);
}
