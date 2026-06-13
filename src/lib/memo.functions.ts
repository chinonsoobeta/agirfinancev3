import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeInvestmentVerdict } from "./verdict";
import { buildAllowedValues, verifyNumericProvenance } from "./engine";

// The LLM's only job here is PROSE around values injected from engine output.
// It runs at temperature 0, and every generated memo is post-verified: each
// numeric token must trace to an approved/default_accepted/calculated input,
// an engine output, or a reconciliation figure. Orphan numbers badge the memo
// needs_review and are persisted in verification_report.

export const generateMemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects").select("*").eq("id", data.project_id).single();
    if (error) throw new Error(error.message);

    const { getAgirModel } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    const { data: assumptions } = await context.supabase
      .from("assumptions")
      .select("field_key,field_label,value_numeric,value_text,unit,status,confidence_score,source_document_id,source_text,formula_text,approved_by,approved_at")
      .eq("project_id", data.project_id)
      .in("status", ["approved", "modified", "default_accepted", "calculated"]);
    const { data: engineInputs } = await context.supabase
      .from("underwriting_inputs")
      .select("key,value_numeric,status,source,formula_text,resolution_note")
      .eq("project_id", data.project_id)
      .in("status", ["approved", "default_accepted", "calculated"]);
    const { data: outputs } = await context.supabase
      .from("financial_outputs")
      .select("scenario_key,metric_key,metric_label,value_numeric,unit,formula_text")
      .eq("project_id", data.project_id);
    const { data: cashFlows } = await context.supabase
      .from("cash_flows")
      .select("scenario_key,period_year,line_key,amount")
      .eq("project_id", data.project_id)
      .limit(400);
    const { data: flags } = await context.supabase
      .from("reconciliation_flags")
      .select("check_key,severity,message,expected,actual,resolved")
      .eq("project_id", data.project_id);

    if (!outputs?.length) {
      throw new Error("No engine outputs exist for this project. Run underwriting first — the memo writes prose around engine output, never numbers of its own.");
    }

    const outputValue = (scenario: string, key: string) =>
      Number(outputs?.find((row: any) => row.scenario_key === scenario && row.metric_key === key)?.value_numeric ?? 0);
    const errorFlags = (flags ?? []).filter((f: any) => f.severity === "error" && !f.resolved);
    const verdictRow = outputs?.find((row: any) => row.scenario_key === "base" && row.metric_key === "verdict");
    const verdict = computeInvestmentVerdict({
      equity_multiple: outputValue("base", "equity_multiple"),
      profit_margin: outputValue("base", "profit_margin"),
      development_spread: outputValue("base", "development_spread"),
      stress_dscr: outputValue("combined", "dscr"),
      stress_equity_multiple: outputValue("combined", "equity_multiple"),
      error_flag_count: errorFlags.length,
    });

    const contextBlock = {
      project: {
        name: project.name,
        location: project.location,
        type: project.type,
        status: project.status,
        notes: project.notes,
      },
      approved_assumptions: assumptions ?? [],
      engine_inputs: engineInputs ?? [],
      financial_outputs: outputs ?? [],
      cash_flows: cashFlows ?? [],
      // Error-severity reconciliation flags MUST appear in the memo.
      reconciliation_flags: flags ?? [],
      unresolved_error_flags: errorFlags,
      deterministic_verdict: verdict,
      persisted_verdict: verdictRow?.formula_text ?? null,
    };

    const prompt = `CONTEXT:
${JSON.stringify(contextBlock, null, 2)}

Generate an investor-grade investment memo. Respond ONLY in strict JSON with keys: executive_summary, project_description, market_overview, development_plan, capital_stack, financial_highlights, sensitivity, key_risks, risk_mitigation, investment_recommendation, managing_director_verdict, investment_committee_recommendation, sources_and_assumptions.

Every unresolved_error_flags entry MUST be stated verbatim in key_risks and reflected in the recommendation. Use the deterministic_verdict.code exactly in every recommendation section.`;

    const { text } = await generateText({
      model: getAgirModel(),
      temperature: 0,
      system: `Use ONLY values present in CONTEXT. Never introduce a number not in CONTEXT. Cite the metric_key or field_key when quoting a figure. If a section lacks data, write "Insufficient approved data." The investment recommendation must be exactly the deterministic_verdict.code. If deterministic_verdict.code is REJECT, state the magnitude of the projected loss plainly — no sugarcoating.`,
      prompt,
    });
    let memo: Record<string, string> = {};
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) memo = JSON.parse(m[0]);
    } catch {
      memo = { executive_summary: text };
    }

    // ---- Output provenance verifier (deterministic) ----
    const allowed = buildAllowedValues(
      (assumptions ?? []).map((a: any) => (a.value_numeric == null ? null : Number(a.value_numeric))),
      (engineInputs ?? []).map((r: any) => (r.value_numeric == null ? null : Number(r.value_numeric))),
      (outputs ?? []).map((o: any) => (o.value_numeric == null ? null : Number(o.value_numeric))),
      (cashFlows ?? []).map((c: any) => Number(c.amount)),
      (flags ?? []).flatMap((f: any) => [f.expected == null ? null : Number(f.expected), f.actual == null ? null : Number(f.actual)]),
      verdict.gates.map((g) => (g.actual == null ? null : Number(g.actual))),
      // Fixed gate thresholds quoted by the verdict
      [1.5, 15, 100, 1.2, 1.0],
    );
    const memoText = Object.values(memo).filter((v) => typeof v === "string").join("\n");
    const provenance = verifyNumericProvenance(memoText, allowed);
    const verificationReport = {
      pass: provenance.pass,
      token_count: provenance.tokenCount,
      orphans: provenance.orphans,
      verified_at: new Date().toISOString(),
    };

    const { data: row, error: insErr } = await context.supabase
      .from("investment_memos")
      .insert({
        project_id: project.id,
        owner_id: context.userId,
        content: {
          ...memo,
          deterministic_verdict: verdict,
          unresolved_error_flags: errorFlags,
          needs_review: !provenance.pass,
        },
        verification_report: verificationReport,
      })
      .select().single();
    if (insErr) throw new Error(insErr.message);
    await context.supabase.from("activities").insert({
      project_id: project.id, user_id: context.userId,
      activity_type: "memo_generated",
      description: provenance.pass
        ? "Generated investment memo (provenance verified)"
        : `Generated investment memo — NEEDS REVIEW: ${provenance.orphans.length} numeric token(s) lack provenance`,
    });
    return row;
  });

export const listMemos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("investment_memos").select("*").eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
