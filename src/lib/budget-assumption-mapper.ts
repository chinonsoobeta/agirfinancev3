import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";
import type { MappedCandidate } from "./assumption-mapping";
import type { ParsedBudgetRow } from "./parsers/budget.server";

const BUDGET_KEY_BY_CATEGORY = {
  land: "land_cost",
  hard: "hard_costs",
  soft: "soft_costs",
  contingency: "contingency",
  financing_interest: "financing_costs",
  other: null,
} as const;

export function mapBudgetRowToAssumption(row: ParsedBudgetRow, sourceDocument: { name: string }): MappedCandidate | null {
  const key = BUDGET_KEY_BY_CATEGORY[row.category];
  if (!key) return null;
  const def = ASSUMPTION_BY_KEY[key];
  return {
    field_key: key,
    value_numeric: row.amount,
    value_text: null,
    unit: def.unit,
    confidence: 98,
    source_doc_name: sourceDocument.name,
    source_text: row.sourceText || `${row.sourceCellRef}: ${row.label} | $${row.amount}`,
    source_location: row.sourceCellRef,
    matched_alias: `${row.category} structured budget row`,
    via: "alias",
  };
}
