export type ReconciliationFlag = {
  check_key: string;
  severity: "info" | "warning" | "error";
  message: string;
  expected?: number;
  actual?: number;
};

function severityFor(deltaPct: number): ReconciliationFlag["severity"] {
  if (deltaPct > 10) return "error";
  if (deltaPct > 5) return "warning";
  return "info";
}

export function reconcileDevelopmentInputs(input: {
  budgetTotal: number;
  statedTdc?: number | null;
  equity?: number | null;
  loan?: number | null;
  statedRevenue?: number | null;
  computedGpr?: number | null;
}) {
  const flags: ReconciliationFlag[] = [];
  const compare = (check_key: string, label: string, expected?: number | null, actual?: number | null) => {
    if (!expected || !actual) return;
    const deltaPct = Math.abs(actual - expected) / Math.abs(expected) * 100;
    if (deltaPct <= 5) return;
    flags.push({
      check_key,
      severity: severityFor(deltaPct),
      message: `${label} differs by ${deltaPct.toFixed(1)}%.`,
      expected,
      actual,
    });
  };
  compare("budget_vs_tdc", "Budget total and stated TDC", input.statedTdc, input.budgetTotal);
  compare("sources_vs_uses", "Equity plus loan and stated TDC", input.statedTdc, (input.equity ?? 0) + (input.loan ?? 0));
  compare("gpr_vs_revenue", "Rent program GPR and stated revenue", input.statedRevenue, input.computedGpr);
  return flags;
}

