// Pure mapping from review-queue taxonomy keys to engine-readable rows.
// Approving an assumption propagates it through this map into
// underwriting_inputs / development_budget / revenue_program — the ONLY tables
// the engine loader reads.

export const TAXONOMY_TO_ENGINE_SCALAR: Record<string, string> = {
  debt_amount: "loan_amount",
  equity_amount: "equity_amount",
  interest_rate: "interest_rate_pct",
  amortization_years: "amort_years",
  min_dscr: "min_dscr",
  exit_cap_rate: "exit_cap_rate_pct",
  stabilized_occupancy: "stabilized_occupancy_pct",
  opex_ratio: "expense_ratio_pct",
  hold_period_years: "hold_years",
  disposition_cost_pct: "selling_costs_pct",
  rent_growth: "rent_growth_pct",
  lease_up_months: "lease_up_months",
  ltc: "stated_ltc_pct",
  total_project_cost: "stated_total_project_cost",
  lender_stabilized_occupancy: "lender_stabilized_occupancy_pct",
  other_income_annual: "other_income_annual",
};

export const ENGINE_SCALAR_TO_TAXONOMY: Record<string, string> = Object.fromEntries(
  Object.entries(TAXONOMY_TO_ENGINE_SCALAR).map(([t, e]) => [e, t]),
);

export const TAXONOMY_TO_BUDGET_CATEGORY: Record<string, string> = {
  land_cost: "land",
  hard_costs: "hard",
  soft_costs: "soft",
  contingency: "contingency",
  financing_costs: "financing_interest",
  environmental_reserve: "other",
  tax_reassessment: "other",
};

export type RevenueComponentMap = {
  unitType: "Residential" | "Retail" | "Office";
  basis: "per_unit" | "per_sf";
  field: "unit_count" | "avg_sf" | "rent" | "occupancy_pct";
};

export const TAXONOMY_TO_REVENUE_FIELD: Record<string, RevenueComponentMap> = {
  residential_units: { unitType: "Residential", basis: "per_unit", field: "unit_count" },
  residential_rent_monthly: { unitType: "Residential", basis: "per_unit", field: "rent" },
  residential_occupancy: { unitType: "Residential", basis: "per_unit", field: "occupancy_pct" },
  retail_sf: { unitType: "Retail", basis: "per_sf", field: "avg_sf" },
  retail_rent_psf: { unitType: "Retail", basis: "per_sf", field: "rent" },
  retail_occupancy: { unitType: "Retail", basis: "per_sf", field: "occupancy_pct" },
  office_sf: { unitType: "Office", basis: "per_sf", field: "avg_sf" },
  office_rent_psf: { unitType: "Office", basis: "per_sf", field: "rent" },
  office_occupancy: { unitType: "Office", basis: "per_sf", field: "occupancy_pct" },
};
