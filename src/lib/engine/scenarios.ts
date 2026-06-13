// Stress scenarios are engine re-runs: runUnderwriting(baseInput + overrides).
// Every stress cell is a real number from a real run -- nothing is synthesized.

import type { UnderwritingInput } from "./types";

export type StressPreset = {
  key: string;
  label: string;
  revenueDeltaPct?: number;
  costDeltaPct?: number;
  capRateDeltaBps?: number;
  rateDeltaBps?: number;
};

export const STRESS_PRESETS: StressPreset[] = [
  { key: "cap_expansion", label: "Cap Expansion (+75 bps)", capRateDeltaBps: 75 },
  { key: "cost_overrun", label: "Cost Overrun (+10%)", costDeltaPct: 10 },
  { key: "rate_shock", label: "Rate Shock (+150 bps)", rateDeltaBps: 150 },
  { key: "revenue_down", label: "Revenue Downside (-10%)", revenueDeltaPct: -10 },
  {
    key: "combined",
    label: "Combined Stress",
    capRateDeltaBps: 75,
    costDeltaPct: 10,
    rateDeltaBps: 150,
    revenueDeltaPct: -10,
  },
];

export function applyStress(input: UnderwritingInput, preset: StressPreset): UnderwritingInput {
  const revenueMultiplier = 1 + (preset.revenueDeltaPct ?? 0) / 100;
  const costMultiplier = 1 + (preset.costDeltaPct ?? 0) / 100;
  return {
    ...input,
    budget: {
      ...input.budget,
      land: input.budget.land * costMultiplier,
      hard: input.budget.hard * costMultiplier,
      soft: input.budget.soft * costMultiplier,
      contingency: input.budget.contingency * costMultiplier,
      financingInterest:
        input.budget.financingInterest == null ? undefined : input.budget.financingInterest * costMultiplier,
      other: input.budget.other == null ? undefined : input.budget.other * costMultiplier,
    },
    revenueProgram: input.revenueProgram.map((row) => ({
      ...row,
      rent: row.rent * revenueMultiplier,
    })),
    otherIncomeAnnual: input.otherIncomeAnnual * revenueMultiplier,
    exitCapRatePct: input.exitCapRatePct + (preset.capRateDeltaBps ?? 0) / 100,
    interestRatePct: input.interestRatePct + (preset.rateDeltaBps ?? 0) / 100,
  };
}
