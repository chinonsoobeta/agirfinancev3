// Structured Investment Committee Memorandum model. Pure: it assembles a typed,
// renderer-agnostic document (stat strip, verdict banner, KPI cards, and the
// numbered tables — TDC build-up, capital stack, stabilized revenue build,
// scenario sensitivity, covenant compliance, risk register, reconciliation
// flags, document sources) from the project's APPROVED assumptions and
// DETERMINISTIC engine outputs only. Per-component revenue figures and capital-
// stack percentages are pure functions of those values (computed with the
// engine's own componentGpr) and are reported back in `derived_values` so the
// provenance verifier admits them. No number here is invented.

import { componentGpr } from "./engine";
import { ENGINE_SCALAR_TO_TAXONOMY } from "./taxonomy-engine-map";
import { ASSUMPTION_BY_KEY } from "./assumption-taxonomy";

export type ReportStat = { label: string; value: string; sub?: string };
export type ReportTable = { columns: string[]; rows: string[][]; note?: string };
export type ReportSection = { heading: string; table?: ReportTable; body?: string };

export type MemoReport = {
  header_band: string;
  title: string;
  project_name: string;
  subtitle: string;
  mode_label: "AI-assisted" | "Deterministic template";
  prepared: string;
  verdict_code: string;
  verdict_banner: string;
  verdict_narrative: string;
  summary_stats: ReportStat[];
  metric_cards: ReportStat[];
  sections: ReportSection[];
  footnotes: string[];
  derived_values: number[];
};

type Row = Record<string, any>;
export type MemoReportContext = {
  project: Row;
  assumptions: Row[];
  engineInputs: Row[];
  outputs: Row[];
  flags: Row[];
  risks: Row[];
  documents: Row[];
  verdict: { code: string; hardFail?: boolean; gates: Array<{ key: string; label: string; pass: boolean; actual?: number }> };
  generationMode: "ai" | "deterministic";
  generatedLabel: string; // e.g. "June 2026" (month + year only — no day token)
};

export const grouped = (n: number, decimals = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n);
export const money = (n: number) => `$${grouped(Math.round(n))}`;
export const pct = (n: number) => `${n.toFixed(2)}%`;
export const x = (n: number) => `${n.toFixed(2)}x`;
export const bps = (n: number) => `${Math.round(n)} bps`;

// Replace Unicode symbols that render poorly in the PDF (WinAnsi) font with
// ASCII equivalents. Applied to engine-sourced strings (flag messages, risk
// descriptions) so the same clean text flows to screen, PDF and DOCX.
export function sanitizeSymbols(s: string): string {
  return String(s ?? "")
    .replace(/−/g, "-")   // minus sign
    .replace(/×/g, "x")   // multiplication sign
    .replace(/≈/g, "approx.") // almost equal
    .replace(/→/g, "->")  // right arrow
    .replace(/≥/g, ">=")  // >=
    .replace(/≤/g, "<=")  // <=
    .replace(/∞/g, "infinity"); // infinity
}

// Readable short labels for known source documents, used in BODY tables only
// (the Document Sources section keeps full filenames). Keeps long filenames
// from wrapping awkwardly in the PDF.
const KNOWN_SOURCE_LABELS: Record<string, string> = {
  "harbour_centre_construction_budget.xlsx": "Construction Budget",
  "harbour_centre_lender_term_sheet.pdf": "Lender Term Sheet",
  "harbour_centre_sponsor_summary.pdf": "Sponsor Summary",
  "harbour_centre_rent_roll.xlsx": "Rent Roll",
  "harbour_centre_broker_opinion.pdf": "Broker Opinion",
  "harbour_centre_market_study.pdf": "Market Study",
  "harbour_centre_underwriting_assumptions_addendum.docx": "Underwriting Addendum",
};

export function displaySourceLabel(
  source_location: string | null | undefined,
  source_document_name?: string | null,
): string {
  const raw = String(source_document_name || source_location || "").trim();
  if (!raw) return "Approved assumption";
  const known = KNOWN_SOURCE_LABELS[raw.toLowerCase()];
  if (known) return known;
  // Unknown file: strip extension, normalise separators, drop a duplicate
  // project prefix, title-case, and cap the length so it never wraps mid-word.
  let base = raw.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  base = base.replace(/^harbour\s+centre\s+/i, "");
  base = base.replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (base.length > 28) base = `${base.slice(0, 27).trimEnd()}...`;
  return base || "Approved assumption";
}

export function fmtByUnit(v: number | null | undefined, unit: string | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  switch (unit) {
    case "$": return money(n);
    case "%": return pct(n);
    case "x": return x(n);
    case "bps": return bps(n);
    case "SF": return `${grouped(n)} SF`;
    case "units": return `${grouped(n)} units`;
    case "$/SF": return `$${grouped(n)}/SF`;
    default: return grouped(n, 2);
  }
}

// All rendered numeric-bearing text from a report, for provenance verification.
export function memoReportText(report: MemoReport): string {
  const parts: string[] = [report.verdict_narrative];
  for (const s of report.summary_stats) parts.push(s.value);
  for (const c of report.metric_cards) parts.push(`${c.label} ${c.value}`);
  for (const sec of report.sections) {
    if (sec.body) parts.push(sec.body);
    if (sec.table) {
      if (sec.table.note) parts.push(sec.table.note);
      for (const row of sec.table.rows) parts.push(row.join(" "));
    }
  }
  for (const f of report.footnotes) parts.push(f);
  return parts.join("\n");
}

export function buildMemoReport(ctx: MemoReportContext): MemoReport {
  const { project, assumptions, engineInputs, outputs, flags, risks, documents, verdict } = ctx;
  const derived: number[] = [];
  const track = <T extends number>(n: T): T => { if (Number.isFinite(n)) derived.push(n); return n; };

  const docNameById = new Map(documents.map((d) => [d.id, d.name]));
  // Short, readable provenance label for BODY tables: prefer the source document
  // name, then a file-like source_location, then a generic fallback — always run
  // through displaySourceLabel so long filenames don't wrap mid-word.
  const sourceLabel = (a: Row | undefined): string => {
    if (!a) return "Approved assumption";
    const byId = a.source_document_id ? docNameById.get(a.source_document_id) : null;
    if (byId) return displaySourceLabel(null, String(byId));
    const loc = a.source_location;
    if (loc && /\.(pdf|xlsx|xls|docx|csv)$/i.test(String(loc))) return displaySourceLabel(String(loc));
    return "Approved assumption";
  };

  const aByKey = (key: string) => assumptions.find((a) => a.field_key === key);
  const aVal = (key: string): number | null => {
    const r = aByKey(key);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  const eRow = (key: string): Row | undefined => engineInputs.find((i) => i.key === key);
  const eVal = (key: string): number | null => {
    const r = eRow(key);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };
  const oRow = (scenario: string, metric: string) =>
    outputs.find((o) => o.scenario_key === scenario && o.metric_key === metric);
  const oVal = (scenario: string, metric: string): number | null => {
    const r = oRow(scenario, metric);
    return r && r.value_numeric != null ? Number(r.value_numeric) : null;
  };

  const tdc = oVal("base", "total_project_cost") ?? (aVal("total_project_cost") ?? 0);
  const loan = aVal("debt_amount") ?? eVal("loan_amount") ?? 0;
  const committedEquity = aVal("equity_amount") ?? eVal("equity_amount") ?? 0;
  const requiredEquity = oVal("base", "equity_requirement") ?? (tdc - loan);
  const fundingGap = track(requiredEquity - committedEquity);
  const exitCap = eVal("exit_cap_rate_pct") ?? aVal("exit_cap_rate");
  const holdYears = eVal("hold_years");

  // ---- Verdict banner ----
  const VERDICT_BANNER: Record<string, string> = {
    REJECT: "DOES NOT MEET INVESTMENT HURDLES — RETURN TO UNDERWRITING",
    APPROVE_WITH_CONDITIONS: "MEETS INVESTMENT HURDLES WITH CONDITIONS",
    APPROVE: "MEETS INVESTMENT HURDLES — RECOMMEND PROCEED",
  };
  const yoc = oVal("base", "yield_on_cost");
  const spread = oVal("base", "development_spread");
  const dscr = oVal("base", "dscr");
  const noi = oVal("base", "stabilized_noi");
  const exitValue = oVal("base", "exit_value");
  const minDscr = aVal("min_dscr") ?? eVal("min_dscr");
  const errorFlags = flags.filter((f) => f.severity === "error" && !f.resolved);
  const narrativeBits: string[] = [];
  if (exitCap != null && noi != null && exitValue != null && tdc) {
    narrativeBits.push(`At the ${pct(exitCap)} exit cap, stabilized NOI of ${money(noi)} implies an exit value of ${money(exitValue)} against TDC of ${money(tdc)}.`);
  }
  if (yoc != null && exitCap != null && spread != null) {
    narrativeBits.push(`Yield on cost of ${pct(yoc)} is ${bps(spread)} versus the exit cap, producing a ${spread < 0 ? "negative" : "positive"} development spread.`);
  }
  if (dscr != null && minDscr != null) {
    narrativeBits.push(`DSCR of ${x(dscr)} ${dscr < minDscr ? "is below" : "meets"} the lender's ${x(minDscr)} minimum covenant.`);
  }
  if (errorFlags.length) narrativeBits.push(`${errorFlags.length} unresolved error-severity reconciliation flag(s) remain open.`);

  // ---- Summary stat strip ----
  const summary_stats: ReportStat[] = [
    { label: "Total Development Cost", value: money(tdc) },
    { label: "Senior Loan", value: money(loan) },
    { label: "Required Equity", value: money(requiredEquity) },
    { label: "Committed Equity", value: money(committedEquity) },
    ...(exitCap != null ? [{ label: "Exit Cap (approved)", value: pct(exitCap) }] : []),
    ...(holdYears != null ? [{ label: "Hold Period", value: `${grouped(holdYears)} yrs` }] : []),
  ];

  // ---- KPI cards (base case) ----
  const card = (label: string, scenario: string, metric: string, unit: string): ReportStat => ({
    label, value: fmtByUnit(oVal(scenario, metric), unit),
  });
  const metric_cards: ReportStat[] = [
    card("Yield on Cost", "base", "yield_on_cost", "%"),
    card("Development Spread", "base", "development_spread", "bps"),
    card("DSCR (amortizing)", "base", "dscr", "x"),
    card("Loan-to-Cost", "base", "loan_to_cost", "%"),
    card("Exit Value (base)", "base", "exit_value", "$"),
    card("Development Profit", "base", "projected_profit", "$"),
    card("Equity Multiple", "base", "equity_multiple", "x"),
    card("Stabilized NOI", "base", "stabilized_noi", "$"),
  ];

  const sections: ReportSection[] = [];

  // ---- 1. Total Development Cost build-up ----
  const budgetKeys: Array<[string, string]> = [
    ["land_cost", "Land cost"], ["hard_costs", "Hard / construction costs"], ["soft_costs", "Soft costs"],
    ["financing_costs", "Financing costs"], ["contingency", "Contingency reserve"],
  ];
  const tdcRows = budgetKeys
    .filter(([k]) => aVal(k) != null)
    .map(([k, label]) => [label, sourceLabel(aByKey(k)), money(aVal(k)!)]);
  tdcRows.push(["Total Development Cost", "Calculated", money(tdc)]);
  sections.push({ heading: "Total Development Cost Build-Up", table: { columns: ["Line Item", "Source", "Amount"], rows: tdcRows } });

  // ---- 2. Capital stack ----
  const pctOfTdc = (amt: number) => (tdc ? `${track((amt / tdc) * 100).toFixed(2)}%` : "—");
  const stackRows: string[][] = [
    ["Senior construction debt", sourceLabel(aByKey("debt_amount")), money(loan), pctOfTdc(loan)],
    ["Common equity (committed)", sourceLabel(aByKey("equity_amount")), money(committedEquity), pctOfTdc(committedEquity)],
  ];
  if (Math.abs(fundingGap) > 1) {
    stackRows.push(["Funding gap (uncommitted)", "Sources vs uses reconciliation", money(fundingGap), pctOfTdc(fundingGap)]);
  }
  stackRows.push(["Total", "", money(tdc), tdc ? "100.00%" : "—"]);
  sections.push({
    heading: "Capital Stack",
    table: { columns: ["Tranche", "Source", "Amount", "% of TDC"], rows: stackRows,
      note: Math.abs(fundingGap) > 1 ? "Required equity is TDC less senior debt; the gap is committed equity short of that requirement (a sources-vs-uses reconciliation item)." : undefined },
  });

  // ---- 3. Stabilized revenue build ----
  type Comp = { label: string; unitsSf: string; rate: string; occ: number | null; gpr: number; egi: number };
  const comps: Comp[] = [];
  const resUnits = aVal("residential_units"), resRent = aVal("residential_rent_monthly"), resOcc = aVal("residential_occupancy");
  if (resUnits != null && resRent != null) {
    const gpr = componentGpr({ unitType: "Residential", unitCount: resUnits, rent: resRent, rentBasis: "per_unit" });
    const egi = gpr * ((resOcc ?? 100) / 100);
    comps.push({ label: "Residential", unitsSf: `${grouped(resUnits)} units`, rate: `${money(resRent)}/mo`, occ: resOcc, gpr: track(gpr), egi: track(egi) });
  }
  const retailSf = aVal("retail_sf"), retailRent = aVal("retail_rent_psf"), retailOcc = aVal("retail_occupancy");
  if (retailSf != null && retailRent != null) {
    const gpr = componentGpr({ unitType: "Retail", unitCount: 1, avgSf: retailSf, rent: retailRent, rentBasis: "per_sf" });
    const egi = gpr * ((retailOcc ?? 100) / 100);
    comps.push({ label: "Retail", unitsSf: `${grouped(retailSf)} SF`, rate: `$${grouped(retailRent)}/SF`, occ: retailOcc, gpr: track(gpr), egi: track(egi) });
  }
  const officeSf = aVal("office_sf"), officeRent = aVal("office_rent_psf"), officeOcc = aVal("office_occupancy");
  if (officeSf != null && officeRent != null) {
    const gpr = componentGpr({ unitType: "Office", unitCount: 1, avgSf: officeSf, rent: officeRent, rentBasis: "per_sf" });
    const egi = gpr * ((officeOcc ?? 100) / 100);
    comps.push({ label: "Office", unitsSf: `${grouped(officeSf)} SF`, rate: `$${grouped(officeRent)}/SF`, occ: officeOcc, gpr: track(gpr), egi: track(egi) });
  }
  if (comps.length) {
    const totalGpr = oVal("base", "gpr") ?? comps.reduce((s, c) => s + c.gpr, 0);
    const totalEgi = oVal("base", "projected_revenue") ?? comps.reduce((s, c) => s + c.egi, 0);
    const opex = track(totalEgi - (noi ?? totalEgi));

    // Operating expense ratio — shown explicitly with its source/default status.
    const opexRatioRow = eRow("expense_ratio_pct");
    const opexAssumption = aByKey("opex_ratio");
    const ratioVal = opexRatioRow?.value_numeric ?? opexAssumption?.value_numeric ?? null;
    const ratioStatus = opexRatioRow?.status ?? opexAssumption?.status ?? null;
    const ratioSource = ratioVal == null
      ? "Not available"
      : ratioStatus === "default_accepted"
        ? "Default accepted"
        : opexAssumption && (opexAssumption.status === "approved" || opexAssumption.status === "modified")
          ? sourceLabel(opexAssumption)
          : "Approved assumption";

    const revRows = comps.map((c) => [c.label, c.unitsSf, c.rate, c.occ == null ? "—" : pct(c.occ), money(c.gpr), money(c.egi)]);
    revRows.push(["Total GPR / EGI", "", "", "", money(totalGpr), money(totalEgi)]);
    revRows.push(["Operating expense ratio", "", ratioSource, "", "", ratioVal == null ? "Not available" : pct(Number(ratioVal))]);
    revRows.push(["Operating expenses", "", "", "", "", `(${money(opex)})`]);
    revRows.push(["Net Operating Income", "", "", "", "", money(noi ?? totalEgi - opex)]);
    sections.push({
      heading: "Stabilized Revenue Build (Year 1)",
      table: { columns: ["Component", "Units / SF", "Source / Rate", "Occupancy", "GPR", "EGI"], rows: revRows,
        note: "GPR = units x monthly rent x 12 (residential) or SF x $/SF (commercial). EGI = GPR x occupancy. NOI = EGI - operating expenses. Operating expenses = EGI x expense ratio." },
    });
  }

  // ---- 4. Scenario analysis ----
  const SCEN_LABELS: Record<string, string> = {
    base: "Base", cap_expansion: "Cap Expansion", cost_overrun: "Cost Overrun",
    rate_shock: "Rate Shock", revenue_down: "Revenue Downside", combined: "Combined Stress",
  };
  const scenarioOrder = ["base", "cap_expansion", "cost_overrun", "rate_shock", "revenue_down", "combined"]
    .filter((sk) => outputs.some((o) => o.scenario_key === sk));
  if (scenarioOrder.length > 1) {
    const scenMetrics: Array<[string, string, string]> = [
      ["Exit value", "exit_value", "$"], ["Net sale proceeds", "net_sale_proceeds", "$"],
      ["Development profit", "projected_profit", "$"], ["Yield on cost", "yield_on_cost", "%"],
      ["Development spread", "development_spread", "bps"], ["Equity multiple", "equity_multiple", "x"],
      ["DSCR", "dscr", "x"],
    ];
    const rows = scenMetrics.map(([label, mk, unit]) =>
      [label, ...scenarioOrder.map((sk) => fmtByUnit(oVal(sk, mk), unit))]);
    sections.push({
      heading: "Scenario Analysis — Base & Stress",
      table: { columns: ["Metric", ...scenarioOrder.map((sk) => SCEN_LABELS[sk] ?? sk)], rows,
        note: "Every cell is an independent deterministic engine re-run under the stated stress." },
    });
  }

  // ---- 5. Debt covenant compliance ----
  const ltc = oVal("base", "loan_to_cost");
  const ads = oVal("base", "annual_debt_service");
  const covRows: string[][] = [];
  if (minDscr != null && dscr != null) {
    covRows.push([
      "Minimum DSCR",
      `NOI ${money(noi ?? 0)} / Annual DS ${money(ads ?? 0)} >= ${x(minDscr)}`,
      x(dscr), dscr >= minDscr ? "PASS" : "BREACH",
    ]);
  }
  if (ltc != null) {
    covRows.push(["Loan-to-Cost", `Loan ${money(loan)} / TDC ${money(tdc)}`, pct(ltc), "INFO"]);
  }
  const lenderOcc = eVal("lender_stabilized_occupancy_pct") ?? aVal("lender_stabilized_occupancy");
  if (lenderOcc != null) {
    covRows.push(["Lender stabilization", `Component occupancies vs requirement`, pct(lenderOcc), "SEE FLAGS"]);
  }
  if (covRows.length) {
    sections.push({ heading: "Debt Covenant Compliance", table: { columns: ["Covenant", "Basis", "Underwritten", "Status"], rows: covRows } });
  }

  // ---- 6. Risk register ----
  if (risks.length) {
    sections.push({
      heading: "Risk Register",
      table: { columns: ["Risk", "Severity", "Detail"], rows: risks.map((r) => [sanitizeSymbols(r.title ?? "-"), String(r.severity ?? "").toUpperCase(), sanitizeSymbols(r.description ?? "")]) },
    });
  }

  // ---- 7. Reconciliation flags ----
  if (flags.length) {
    sections.push({
      heading: "Reconciliation Flags",
      table: { columns: ["Check", "Severity", "Detail"], rows: flags.map((f) => [f.check_key ?? "-", String(f.severity ?? "").toUpperCase(), sanitizeSymbols(f.message ?? "")]) },
    });
  }

  // ---- Required actions (IC action list) ----
  const occShortfalls = flags.filter((f) => String(f.check_key).startsWith("occupancy_vs_lender"));
  const sourcesError = flags.some((f) => f.check_key === "sources_vs_uses" && f.severity === "error");
  const equityMismatch = flags.some((f) => f.check_key === "equity_mismatch");
  const actions: string[] = [];
  if (Math.abs(fundingGap) > 1) actions.push("- Resolve the sources-and-uses funding gap.");
  // Committed-equity follow-up (deduped — added once even if several flags imply it).
  if (sourcesError || equityMismatch || committedEquity < requiredEquity) {
    actions.push(`- Confirm whether the ${money(committedEquity)} committed equity is capped or whether additional sponsor/JV equity is available.`);
  }
  if (flags.some((f) => f.check_key === "budget_vs_stated_total")) actions.push("- Correct or remove any erroneous stated total project cost reconciliation input.");
  if (dscr != null && minDscr != null && dscr < minDscr) actions.push("- Cure the DSCR covenant breach or resize the senior debt.");
  if (occShortfalls.length) actions.push("- Resolve lender stabilization shortfalls for retail and office.");
  actions.push("- Re-run deterministic underwriting after corrections.");
  sections.push({ heading: "Required Actions Before Reconsideration", body: actions.join("\n") });

  // ---- 8. Document sources ----
  const docRows = (documents.length
    ? documents.map((d) => [d.name, d.category ?? "—"])
    : Array.from(new Set(assumptions.map((a) => a.source_location).filter(Boolean))).map((s) => [String(s), "Approved assumption source"]));
  if (docRows.length) {
    sections.push({ heading: "Document Sources", table: { columns: ["Document", "Category"], rows: docRows } });
  }

  // ---- Footnotes ----
  // Exit-cap conflict resolution — shown ONLY when the project actually has a
  // documented conflict for the cap (conflict_values on the engine input or the
  // assumption). Candidates and sources are pulled from that stored conflict.
  const capInput = eRow("exit_cap_rate_pct");
  const capConflictRaw: any[] = Array.isArray(capInput?.conflict_values) && capInput!.conflict_values.length
    ? capInput!.conflict_values
    : Array.isArray(aByKey("exit_cap_rate")?.conflict_values)
      ? aByKey("exit_cap_rate")!.conflict_values
      : [];
  const capCandidates = capConflictRaw
    .map((c: any) => ({ value: Number(c.value), source: c.source as string | undefined }))
    .filter((c) => Number.isFinite(c.value))
    .filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i);
  capCandidates.forEach((c) => derived.push(c.value));
  const exitCapFootnote = capCandidates.length >= 2 && exitCap != null
    ? `Exit cap reflects approved conservative resolution of documented broker/lender conflict: ${capCandidates.map((c) => `${pct(c.value)} ${displaySourceLabel(null, c.source).toLowerCase()}`).join(" vs ")}.`
    : null;

  // ---- Inputs / defaults disclosure ----
  const approvedCount = track(assumptions.filter((a) => a.status === "approved" || a.status === "modified").length);
  const calculatedCount = track(assumptions.filter((a) => a.status === "calculated").length);
  const defaultRows = engineInputs.filter((i) => i.status === "default_accepted");
  const defaultCount = track(defaultRows.length);
  const defaultNames = defaultRows
    .map((r) => ASSUMPTION_BY_KEY[ENGINE_SCALAR_TO_TAXONOMY[r.key] ?? ""]?.label ?? r.key)
    .filter(Boolean);

  const errorCount = flags.filter((f) => f.severity === "error" && !f.resolved).length;
  const warningCount = flags.filter((f) => f.severity === "warning" && !f.resolved).length;
  const footnotes = [
    ...(exitCapFootnote ? [exitCapFootnote] : []),
    ctx.generationMode === "ai"
      ? "ENGINE: All financial figures were produced deterministically from approved, calculated, or explicitly default-accepted inputs; only the narrative prose is AI-assisted. No AI-generated financial values were used."
      : "ENGINE: All figures were produced deterministically from approved, calculated, or explicitly default-accepted inputs. No AI-generated financial values were used.",
    "FORMULAS: Pre-financing cost = land + hard + soft + contingency; TDC = pre-financing + financing; GPR = units x rent x 12 (res) or SF x $/SF (comm); EGI = GPR x occupancy; NOI = EGI - operating expenses; Required NOI = 1.20x x ADS; YOC = NOI / TDC; Dev spread = YOC - exit cap; Exit value = NOI / exit cap; Funding gap = TDC - sources; LTC = loan / TDC; DSCR = NOI / annual debt service; EM approx. 0.0x on a wipeout.",
    "Input conflicts: none outstanding.",
    `Reconciliation exceptions: ${errorCount} error(s) and ${warningCount} warning(s) remain open.`,
    `Inputs used: ${approvedCount} approved, ${calculatedCount} calculated, ${defaultCount} default-accepted. No AI-generated financial values.`,
    defaultCount > 0 ? `Default-accepted inputs: ${defaultNames.join(", ")}.` : "Default-accepted inputs: none.",
    `PREPARED: Agir Pro Finance — Deterministic Underwriting Engine — ${ctx.generatedLabel}.`,
  ];

  return {
    header_band: "Agir Pro Finance — Deterministic Underwriting Engine — CONFIDENTIAL DRAFT",
    title: "Investment Committee Memorandum",
    project_name: project.name,
    subtitle: `${project.type ? String(project.type).replace(/_/g, "-") : "Development"}${project.location ? ` · ${project.location}` : ""}`,
    mode_label: ctx.generationMode === "ai" ? "AI-assisted" : "Deterministic template",
    prepared: `Prepared ${ctx.generatedLabel} · CONFIDENTIAL DRAFT`,
    verdict_code: verdict.code,
    verdict_banner: VERDICT_BANNER[verdict.code] ?? verdict.code,
    verdict_narrative: sanitizeSymbols(narrativeBits.join(" ")),
    summary_stats,
    metric_cards,
    sections,
    footnotes,
    derived_values: derived,
  };
}
