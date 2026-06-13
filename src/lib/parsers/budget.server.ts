import * as XLSX from "xlsx";

export type ParsedBudgetRow = {
  label: string;
  amount: number;
  category: "land" | "hard" | "soft" | "contingency" | "financing_interest" | "other";
  sourceCellRef: string;
};

export type BudgetParseResult = {
  inserted: ParsedBudgetRow[];
  rejected: { row: number; reason: string; values: unknown[] }[];
};

function categoryFor(label: string): ParsedBudgetRow["category"] {
  const normalized = label.toLowerCase();
  if (/land|acquisition|site/.test(normalized)) return "land";
  if (/hard|construction|gmp|sitework|building/.test(normalized)) return "hard";
  if (/soft|design|architect|permit|legal/.test(normalized)) return "soft";
  if (/contingenc/.test(normalized)) return "contingency";
  if (/interest|financing|loan fee|lender/.test(normalized)) return "financing_interest";
  return "other";
}

export function parseBudgetWorkbook(buffer: ArrayBuffer): BudgetParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const inserted: ParsedBudgetRow[] = [];
  const rejected: BudgetParseResult["rejected"] = [];

  const header = rows[0]?.map((cell) => String(cell ?? "").toLowerCase()) ?? [];
  const labelIndex = Math.max(0, header.findIndex((h) => /item|description|label|category/.test(h)));
  const amountIndex = Math.max(1, header.findIndex((h) => /amount|cost|budget|total/.test(h)));

  rows.slice(1).forEach((row, i) => {
    const rowNumber = i + 2;
    const label = String(row[labelIndex] ?? "").trim();
    const rawAmount = row[amountIndex];
    const amount = typeof rawAmount === "number" ? rawAmount : Number(String(rawAmount ?? "").replace(/[$,]/g, ""));
    if (!label || !Number.isFinite(amount)) {
      rejected.push({ row: rowNumber, reason: "Missing label or numeric amount.", values: row });
      return;
    }
    inserted.push({
      label,
      amount,
      category: categoryFor(label),
      sourceCellRef: `${XLSX.utils.encode_col(amountIndex)}${rowNumber}`,
    });
  });

  return { inserted, rejected };
}

