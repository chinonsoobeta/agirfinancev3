import * as XLSX from "xlsx";

export type ParsedRentRollRow = {
  unitType: string;
  unitCount: number;
  avgSf: number | null;
  // per_unit: $/unit/month; per_sf: ANNUAL $/SF.
  rent: number;
  rentBasis: "per_unit" | "per_sf";
  occupancyPct: number | null;
  sourceCellRef: string;
};

// Deterministic, row-typed parsing (never sheet_to_csv). Multi-row tables map
// to multi-row targets: each rent-roll component becomes its own
// revenue_program row with its own occupancy — never collapsed to a scalar.
export function parseRentRollWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const inserted: ParsedRentRollRow[] = [];
  const rejected: { row: number; reason: string; values: unknown[] }[] = [];

  const header = rows[0]?.map((cell) => String(cell ?? "").toLowerCase()) ?? [];
  const typeIndex = Math.max(0, header.findIndex((h) => /unit type|type|plan|component/.test(h)));
  const countIndex = Math.max(1, header.findIndex((h) => /count|units|qty/.test(h)));
  const sfIndex = header.findIndex((h) => /sf|square/.test(h));
  const rentIndex = Math.max(2, header.findIndex((h) => /rent|rate/.test(h)));
  const occupancyIndex = header.findIndex((h) => /occupanc|occ\.?\s|occ%|occ$/.test(h));
  const rentHeader = header[rentIndex] ?? "";
  const perSfRent = /psf|\/\s?sf|per\s?sf|per\s?square/.test(rentHeader);

  const parseNumeric = (cell: unknown): number =>
    typeof cell === "number" ? cell : Number(String(cell ?? "").replace(/[$,%\s]/g, ""));

  rows.slice(1).forEach((row, i) => {
    const rowNumber = i + 2;
    const unitType = String(row[typeIndex] ?? "").trim();
    const unitCount = parseNumeric(row[countIndex] ?? 0);
    const avgSf = sfIndex >= 0 ? parseNumeric(row[sfIndex] ?? 0) || null : null;
    const rent = parseNumeric(row[rentIndex]);
    const occupancyRaw = occupancyIndex >= 0 ? parseNumeric(row[occupancyIndex]) : NaN;
    // Accept either 0-1 fractions or 0-100 percents from the sheet.
    const occupancyPct = Number.isFinite(occupancyRaw) && occupancyRaw > 0
      ? (occupancyRaw <= 1 ? occupancyRaw * 100 : occupancyRaw)
      : null;
    if (!unitType || !Number.isFinite(unitCount) || !Number.isFinite(rent) || rent <= 0) {
      rejected.push({ row: rowNumber, reason: "Missing unit type, count, or rent.", values: row });
      return;
    }
    const rentBasis: ParsedRentRollRow["rentBasis"] = perSfRent && avgSf ? "per_sf" : "per_unit";
    inserted.push({
      unitType,
      unitCount: rentBasis === "per_sf" && unitCount <= 0 ? 1 : unitCount,
      avgSf,
      rent,
      rentBasis,
      occupancyPct,
      sourceCellRef: `${XLSX.utils.encode_col(rentIndex)}${rowNumber}`,
    });
  });

  return { inserted, rejected };
}
