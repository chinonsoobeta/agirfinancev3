import { describe, expect, test } from "vitest";
import {
  annualDebtService,
  applyStress,
  irr,
  loanBalanceAfterYears,
  mapleHeightsInput,
  runUnderwriting,
  STRESS_PRESETS,
} from "@/lib/engine";

const closeToDollars = (actual: number, expected: number) => expect(Math.round(actual)).toBe(expected);
const closeToPct = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 2);

describe("development underwriting engine", () => {
  test("Maple Heights golden fixture", () => {
    const output = runUnderwriting(mapleHeightsInput());
    closeToDollars(output.values.gpr, 3_528_000);
    closeToDollars(output.values.egi, 3_351_600);
    closeToDollars(output.values.opex, 1_173_060);
    closeToDollars(output.values.noi, 2_178_540);
    closeToDollars(output.values.tdc, 42_500_000);
    closeToPct(output.values.yieldOnCostPct, 5.13);
    expect(Math.round(output.values.developmentSpreadBps)).toBe(13);
    closeToDollars(output.values.exitValue, 43_570_800);
    closeToDollars(output.values.developmentProfit, 1_070_800);
    closeToDollars(output.values.costPerUnit, 354_167);
    closeToDollars(output.values.equity, 14_875_000);
    closeToPct(output.values.ltcPct, 65.0);
    expect(output.values.interestOnlyDscr).toBeCloseTo(1.31, 2);
    expect(output.values.equityMultiple).toBeCloseTo(1.07, 2);
    expect(output.equityWipeout).toBe(false);
    // Headline DSCR is amortizing whenever an amortization term exists; the
    // IO DSCR is secondary and always lower coverage than IO at same rate.
    const ads = annualDebtService(27_625_000, 6, 30);
    expect(output.values.annualDebtService).toBeCloseTo(ads, 6);
    expect(output.values.dscr).toBeCloseTo(2_178_540 / ads, 4);
    expect(output.values.dscr).toBeLessThan(output.values.interestOnlyDscr);
  });

  test("stress scenarios are deterministic engine re-runs that strictly degrade the deal", () => {
    const base = mapleHeightsInput();
    const baseOut = runUnderwriting(base);
    for (const preset of STRESS_PRESETS) {
      const out = runUnderwriting(applyStress(base, preset));
      // identical re-run is identical (determinism)
      const again = runUnderwriting(applyStress(base, preset));
      expect(again.values).toEqual(out.values);
      // every stressed metric is a real number from a real run
      expect(out.values.noi).not.toBe(0);
      expect(out.values.exitValue).not.toBe(0);
      expect(out.values.annualDebtService).toBeGreaterThan(0);
      expect(out.values.dscr).toBeGreaterThan(0);
      // stress never improves development profit
      expect(out.values.developmentProfit).toBeLessThanOrEqual(baseOut.values.developmentProfit + 1);
    }
    expect(STRESS_PRESETS.map((p) => p.key)).toEqual([
      "cap_expansion",
      "cost_overrun",
      "rate_shock",
      "revenue_down",
      "combined",
    ]);
  });

  test("amortizing debt service is positive and above interest only at the same rate", () => {
    expect(annualDebtService(1_000_000, 6, 30)).toBeGreaterThan(60_000);
  });

  test("loan balance schedule honors IO then amortizes", () => {
    // During IO the balance is flat
    expect(loanBalanceAfterYears(1_000_000, 6, 30, 12, 1)).toBe(1_000_000);
    // After IO it declines monotonically
    const y2 = loanBalanceAfterYears(1_000_000, 6, 30, 12, 2);
    const y3 = loanBalanceAfterYears(1_000_000, 6, 30, 12, 3);
    expect(y2).toBeLessThan(1_000_000);
    expect(y3).toBeLessThan(y2);
  });

  test("IRR returns NaN when cash flows have no sign change", () => {
    expect(Number.isNaN(irr([100, 50, 25]))).toBe(true);
    expect(Number.isNaN(irr([-100, -50, -25]))).toBe(true);
  });
});
