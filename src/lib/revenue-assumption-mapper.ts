import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";
import type { MappedCandidate } from "./assumption-mapping";
import type { ParsedRentRollRow } from "./parsers/rent-roll.server";

type RevenueAssumptionKey =
  | "residential_units"
  | "residential_rent_monthly"
  | "residential_occupancy"
  | "retail_sf"
  | "retail_rent_psf"
  | "retail_occupancy"
  | "office_sf"
  | "office_rent_psf"
  | "office_occupancy";

type RevenueAssumptionValue = {
  key: RevenueAssumptionKey;
  value: number | null;
};

function componentName(unitType: string): "Residential" | "Retail" | "Office" | null {
  const t = unitType.toLowerCase();
  if (/\bresidential|apartment|multifamily|multi-family\b/.test(t)) return "Residential";
  if (/\bretail|shop|storefront\b/.test(t)) return "Retail";
  if (/\boffice|commercial office\b/.test(t)) return "Office";
  return null;
}

export function revenueSourceText(row: ParsedRentRollRow): string {
  const parts = [
    `Unit Type=${row.unitType}`,
    `Unit Count=${row.unitCount}`,
    row.avgSf != null ? `Avg SF=${row.avgSf}` : null,
    `Market Rent=$${row.rent}`,
    `Rent Basis=${row.rentBasis}`,
    row.occupancyPct != null ? `Occupancy=${row.occupancyPct.toFixed(2)}%` : null,
  ].filter(Boolean);
  return `${row.sourceCellRef}: ${parts.join(" | ")}`;
}

export function mapRevenueProgramRowToAssumptions(row: ParsedRentRollRow, sourceDocument: { name: string }): MappedCandidate[] {
  const component = componentName(row.unitType);
  if (!component) return [];

  const values: RevenueAssumptionValue[] =
    component === "Residential"
      ? [
          { key: "residential_units", value: row.unitCount },
          { key: "residential_rent_monthly", value: row.rentBasis === "per_unit" ? row.rent : null },
          { key: "residential_occupancy", value: row.occupancyPct },
        ]
      : component === "Retail"
        ? [
            { key: "retail_sf", value: row.avgSf },
            { key: "retail_rent_psf", value: row.rentBasis === "per_sf" ? row.rent : null },
            { key: "retail_occupancy", value: row.occupancyPct },
          ]
        : [
            { key: "office_sf", value: row.avgSf },
            { key: "office_rent_psf", value: row.rentBasis === "per_sf" ? row.rent : null },
            { key: "office_occupancy", value: row.occupancyPct },
          ];

  const source_text = revenueSourceText(row);
  return values.flatMap(({ key, value }) => {
    if (value == null || !Number.isFinite(value)) return [];
    const def = ASSUMPTION_BY_KEY[key];
    return [{
      field_key: key,
      value_numeric: value,
      value_text: null,
      unit: def.unit,
      confidence: 98,
      source_doc_name: sourceDocument.name,
      source_text,
      source_location: row.sourceCellRef,
      matched_alias: `${component} structured rent-roll row`,
      via: "alias" as const,
    }];
  });
}
