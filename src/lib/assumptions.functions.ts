// The Assumption Engine: extraction, approval, versioning, recalculation,
// readiness scoring, impact analysis, decision logging, audit trail.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ASSUMPTION_DEFS, ASSUMPTION_BY_KEY, ASSUMPTION_KEYS, REQUIRED_KEYS, resolveAlias, bandFor } from "./assumption-taxonomy";

// ---------- Read APIs ----------

export const listAssumptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("assumptions")
      .select("*, documents:source_document_id(name)")
      .eq("project_id", data.project_id)
      .order("category", { ascending: true })
      .order("field_label", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAssumptionVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { assumption_id: string }) => z.object({ assumption_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("assumption_versions").select("*").eq("assumption_id", data.assumption_id)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listFinancialOutputs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("financial_outputs").select("*").eq("project_id", data.project_id)
      .order("scenario_key").order("metric_key");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listRisks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("risk_register").select("*").eq("project_id", data.project_id)
      .order("severity", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listDecisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("decision_logs").select("*").eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("audit_logs").select("*").eq("project_id", data.project_id)
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Cross-project Review Center listing
export const listAssumptionsAcrossProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assumptions").select("*, projects:project_id(name)")
      .order("status", { ascending: true }).order("confidence_score", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Helpers ----------

async function auditLog(ctx: any, projectId: string | null, entityType: string, entityId: string | null, action: string, payload: unknown) {
  await ctx.supabase.from("audit_logs").insert({
    project_id: projectId, owner_id: ctx.userId, user_id: ctx.userId,
    entity_type: entityType, entity_id: entityId, action, payload: payload as object,
  });
}

async function userName(ctx: any) {
  const { data } = await ctx.supabase.from("profiles").select("full_name,email").eq("id", ctx.userId).maybeSingle();
  return data?.full_name || data?.email || "user";
}

async function recordVersion(ctx: any, a: any, changeReason: string, by: string) {
  await ctx.supabase.from("assumption_versions").insert({
    assumption_id: a.id, owner_id: ctx.userId, version_number: a.current_version,
    value_numeric: a.value_numeric, value_text: a.value_text, status: a.status,
    confidence_score: a.confidence_score, confidence_band: a.confidence_band,
    source_document_id: a.source_document_id, source_text: a.source_text,
    changed_by: ctx.userId, changed_by_name: by, change_reason: changeReason,
  });
}

const PRESENT_STATUSES = new Set(["extracted", "conflicting", "approved", "modified", "default_accepted", "calculated"]);
const COMPONENT_OCCUPANCY_KEYS = ["residential_occupancy", "retail_occupancy", "office_occupancy"];

function hasPresentAssumption(map: Map<string, any>, key: string) {
  const row = map.get(key);
  return Boolean(row && PRESENT_STATUSES.has(row.status) && row.status !== "rejected" && row.status !== "missing");
}

function hasCompleteComponentOccupancy(map: Map<string, any>) {
  return COMPONENT_OCCUPANCY_KEYS.every((key) => hasPresentAssumption(map, key));
}

function requiredKeysSatisfiedBy(map: Map<string, any>) {
  return REQUIRED_KEYS.filter((key) => {
    if (key === "stabilized_occupancy" && hasCompleteComponentOccupancy(map)) return true;
    return hasPresentAssumption(map, key);
  });
}

// ---------- Extraction (3-stage pipeline) ----------
//
// Stage 1 — Document Parsing: regex sweep of every uploaded document
//   pulls currency values, percentages, dates, unit counts, square
//   footage, and ratios. Output is a typed candidate list with the
//   surrounding context and the phrase to the LEFT of the match
//   (the natural label).
//
// Stage 2 — Assumption Classification: the AI receives the candidate
//   list (NOT the raw document) and must label each candidate with one
//   of our canonical field_keys or "ignore". This constrains the AI to
//   real values lifted from the documents and removes hallucinations.
//
// Stage 3 — Assumption Mapping: candidates classified by the AI are
//   merged with alias-based fallbacks (resolveAlias on label_hint).
//   Multiple distinct values for the same key become a conflict.

const ClassificationSchema = z.object({
  candidate_index: z.number().int(),
  field_key: z.string(),
  confidence_score: z.number().min(0).max(100),
  reasoning: z.string().optional(),
});

export const extractAssumptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: docs, error: dErr } = await context.supabase
      .from("documents").select("*").eq("project_id", data.project_id);
    if (dErr) throw new Error(dErr.message);
    if (!docs?.length) throw new Error("Upload documents to this project before extracting assumptions.");

    // ===== Stage 1 — Document Parsing =====
    const { extractFileText } = await import("./document-text.server");
    const { extractCandidates } = await import("./assumption-candidates.server");
    type Cand = Awaited<ReturnType<typeof extractCandidates>>[number];
    const allCandidates: Cand[] = [];
    const docByName = new Map(docs.map((d) => [d.name, d]));
    const skippedDocs: string[] = [];
    for (const d of docs) {
      try {
        const { downloadDocumentBlob } = await import("./storage-download.server");
        const dl = await downloadDocumentBlob(context.supabase, d.storage_path);
        if (dl.error || !dl.data) {
          skippedDocs.push(`${d.name}: ${dl.error?.message ?? "download failed"}`);
          continue;
        }
        const buf = await dl.data.arrayBuffer();
        const text = await extractFileText(d.name, d.file_type, buf);
        const cands = extractCandidates(d.name, text.slice(0, 40000));
        allCandidates.push(...cands);
      } catch (error) {
        skippedDocs.push(`${d.name}: ${error instanceof Error ? error.message : "unreadable document"}`);
      }
    }
    if (!allCandidates.length) {
      if (skippedDocs.length) {
        throw new Error(`No extractable values found because uploaded documents could not be read: ${skippedDocs.join("; ")}`);
      }
      throw new Error("No extractable values found in uploaded documents.");
    }

    // ===== Stage 2 — AI Classification =====
    const taxonomyText = ASSUMPTION_DEFS.map(
      (d) => `- ${d.key} (${d.label}, unit ${d.unit}${d.required ? ", REQUIRED" : ""}) aliases: ${d.aliases.slice(0, 6).join(" / ")}`
    ).join("\n");
    const cap = Math.min(allCandidates.length, 220);
    const candidateList = allCandidates.slice(0, cap).map((c, i) =>
      `${i}. [${c.kind}] value=${c.value_text} ctx="${c.context.slice(0, 220)}" hint="${c.label_hint.slice(0, 80)}" doc="${c.doc_name}"`
    ).join("\n");

    const { getAgirModel } = await import("./ai-gateway.server");
    const { generateText } = await import("ai");
    let classifications: z.infer<typeof ClassificationSchema>[] = [];
    try {
      const { text } = await generateText({
        model: getAgirModel(),
        // temperature 0: identical documents must yield identical assumption sets.
        temperature: 0,
        system: `You are an institutional real estate underwriter. Classify pre-extracted numeric candidates from project documents into canonical assumption keys. Use ONLY the candidate context to decide; never invent values. If a candidate clearly does not match any canonical assumption, use field_key="ignore".`,
        prompt: `Canonical assumption taxonomy:\n${taxonomyText}\n\nCandidates (index. [kind] value ctx hint doc):\n${candidateList}\n\nReturn a single JSON array (no prose, no markdown fences). One entry per candidate you classify. Schema: {"candidate_index":<int>,"field_key":"<taxonomy key or ignore>","confidence_score":<0-100>,"reasoning":"<short>"}. Skip candidates you cannot confidently classify.`,
      });
      const m = text.match(/\[[\s\S]*\]/);
      const parsed = m ? JSON.parse(m[0]) : [];
      const safe = z.array(ClassificationSchema).safeParse(parsed);
      if (safe.success) classifications = safe.data.filter((c) => c.field_key === "ignore" || ASSUMPTION_KEYS.includes(c.field_key));
    } catch {
      classifications = [];
    }

    // ===== Stage 3 — Assumption Mapping (AI + alias fallback) =====
    type Mapped = {
      field_key: string; value_numeric: number | null; value_text: string | null;
      confidence_score: number; source_doc_name: string; source_text: string;
      reasoning: string; via: "ai" | "alias";
    };
    const mapped: Mapped[] = [];

    for (const cls of classifications) {
      if (cls.field_key === "ignore") continue;
      const cand = allCandidates[cls.candidate_index];
      if (!cand) continue;
      const def = ASSUMPTION_BY_KEY[cls.field_key];
      if (!def) continue;
      mapped.push({
        field_key: def.key,
        value_numeric: def.numeric ? cand.value_numeric : null,
        value_text: def.numeric ? null : cand.value_text,
        confidence_score: Math.round(cls.confidence_score),
        source_doc_name: cand.doc_name,
        source_text: cand.context,
        reasoning: cls.reasoning || "AI-classified candidate",
        via: "ai",
      });
    }

    // Alias fallback — for any candidate the AI ignored, check if the
    // label hint matches a canonical alias. Adds inferred values.
    const aiCandidateIndices = new Set(classifications.filter((c) => c.field_key !== "ignore").map((c) => c.candidate_index));
    let inferredCount = 0;
    for (let i = 0; i < allCandidates.length; i++) {
      if (aiCandidateIndices.has(i)) continue;
      const cand = allCandidates[i];
      const fk = resolveAlias(cand.label_hint);
      if (!fk) continue;
      const def = ASSUMPTION_BY_KEY[fk];
      if (!def || !def.numeric || cand.value_numeric == null) continue;
      // Unit sanity check
      if (def.unit === "%" && cand.kind !== "percent") continue;
      if (def.unit === "$" && cand.kind !== "currency") continue;
      if (def.unit === "SF" && cand.kind !== "sf") continue;
      if ((def.unit === "yr" || def.unit === "mo") && cand.kind !== "duration") continue;
      if (def.unit === "$/SF" && cand.kind !== "rent") continue;
      mapped.push({
        field_key: def.key,
        value_numeric: cand.value_numeric,
        value_text: null,
        confidence_score: 55,
        source_doc_name: cand.doc_name,
        source_text: cand.context,
        reasoning: `Alias-matched "${cand.label_hint.slice(-40)}" → ${def.label}`,
        via: "alias",
      });
      inferredCount++;
    }

    // Group by field_key and detect conflicts (multiple distinct numeric values)
    const grouped = new Map<string, Mapped[]>();
    for (const m of mapped) {
      const arr = grouped.get(m.field_key) ?? [];
      arr.push(m);
      grouped.set(m.field_key, arr);
    }

    const conflictKeys: string[] = [];
    const foundKeys: string[] = [];
    const proposedKeys: string[] = [];
    const auditEntries: { field_key: string; status: string; chosen?: number | string | null; alternates?: (number | string | null)[]; source_doc?: string }[] = [];

    const { data: existing } = await context.supabase
      .from("assumptions").select("*").eq("project_id", data.project_id);
    const existingByKey = new Map((existing ?? []).map((a) => [a.field_key, a]));
    const ANALYST_LOCKED = new Set(["approved", "modified", "default_accepted"]);

    for (const [fk, arr] of grouped.entries()) {
      const def = ASSUMPTION_BY_KEY[fk];
      arr.sort((a, b) => b.confidence_score - a.confidence_score);
      const winner = arr[0];
      const distinct = Array.from(new Set(arr.map((a) =>
        a.value_numeric != null ? Math.round(a.value_numeric * 1000) / 1000 : a.value_text
      )));
      const isConflict = distinct.length > 1;

      const prev = existingByKey.get(fk);
      // Re-running extraction never silently overwrites approved/analyst rows.
      // New candidates for an approved key surface as proposed changes.
      if (prev && ANALYST_LOCKED.has(prev.status)) {
        const prevValue = prev.value_numeric != null ? Math.round(Number(prev.value_numeric) * 1000) / 1000 : prev.value_text;
        const newCandidates = distinct.filter((v) => v !== prevValue);
        if (newCandidates.length) {
          proposedKeys.push(fk);
          auditEntries.push({ field_key: fk, status: "proposed_change", chosen: prevValue, alternates: newCandidates, source_doc: winner.source_doc_name });
          await auditLog(context, data.project_id, "assumption", prev.id, "extraction_proposed_change", {
            field_key: fk, approved_value: prevValue, proposed_values: newCandidates, source_doc: winner.source_doc_name,
          });
        }
        continue;
      }

      if (isConflict) conflictKeys.push(fk);
      else foundKeys.push(fk);

      const srcDoc = docByName.get(winner.source_doc_name);
      const status: "extracted" | "conflicting" = isConflict ? "conflicting" : "extracted";
      // Conflicts carry NO single value: both candidates are stored
      // side-by-side with sources, and the key blocks readiness until resolved.
      const conflictValues = isConflict
        ? arr
            .filter((a) => a.value_numeric != null)
            .map((a) => ({ value: a.value_numeric, source: a.source_doc_name }))
            .filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i)
        : null;
      const payload = {
        project_id: data.project_id, owner_id: context.userId,
        field_key: def.key, field_label: def.label, category: def.category, unit: def.unit,
        value_numeric: isConflict ? null : winner.value_numeric,
        value_text: isConflict ? null : winner.value_text,
        status,
        conflict_values: conflictValues,
        confidence_score: winner.confidence_score,
        confidence_band: bandFor(winner.confidence_score),
        source_document_id: srcDoc?.id ?? null,
        source_location: srcDoc?.name ?? null,
        source_text: winner.source_text,
        ai_reasoning: isConflict
          ? `Conflicting values across documents: ${distinct.join(" vs ")}. Resolve by picking one or using "use conservative" — values are never averaged or blended.`
          : `${winner.via === "alias" ? "Alias-mapped" : "AI-classified"}: ${winner.reasoning}`,
      };

      if (prev) {
        const { data: upd, error: updErr } = await context.supabase.from("assumptions").update({
          ...payload, current_version: prev.current_version + 1,
        }).eq("id", prev.id).select().single();
        if (updErr) throw new Error(`Failed to update assumption ${fk}: ${updErr.message}`);
        if (upd) await recordVersion(context, upd, `Re-extracted via 3-stage pipeline (${status})`, "Extraction Pipeline");
      } else {
        const { data: ins, error: insErr } = await context.supabase.from("assumptions").insert(payload).select().single();
        if (insErr) throw new Error(`Failed to insert assumption ${fk}: ${insErr.message}`);
        if (ins) await recordVersion(context, ins, `Initial extraction (${status})`, "Extraction Pipeline");
      }

      auditEntries.push({
        field_key: fk, status,
        chosen: isConflict ? null : winner.value_numeric ?? winner.value_text,
        alternates: isConflict ? distinct : undefined,
        source_doc: winner.source_doc_name,
      });
    }

    // Derived tier: a derivable total is never "missing". If the five budget
    // components are present (and unconflicted), total_project_cost is written
    // as status='calculated' with its formula.
    const calculatedKeys: string[] = [];
    const numericFor = (key: string): number | null => {
      if (conflictKeys.includes(key)) return null;
      const fromRun = grouped.get(key)?.[0];
      if (fromRun?.value_numeric != null && !conflictKeys.includes(key)) return fromRun.value_numeric;
      const prev = existingByKey.get(key);
      if (prev && prev.status !== "missing" && prev.status !== "rejected" && prev.value_numeric != null) {
        return Number(prev.value_numeric);
      }
      return null;
    };
    const budgetComponentKeys = ["land_cost", "hard_costs", "soft_costs", "contingency", "financing_costs"];
    const budgetComponents = budgetComponentKeys.map((k) => ({ key: k, value: numericFor(k) }));
    const tdcAlreadyExtracted = grouped.has("total_project_cost") ||
      (existingByKey.get("total_project_cost") && !["missing", "rejected"].includes(existingByKey.get("total_project_cost")!.status) && existingByKey.get("total_project_cost")!.status !== "calculated");
    if (budgetComponents.every((c) => c.value != null) && !tdcAlreadyExtracted) {
      const total = budgetComponents.reduce((s, c) => s + (c.value ?? 0), 0);
      const fmtMoney = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
      const formula = `total_project_cost = ${budgetComponents.map((c) => `${c.key} ${fmtMoney(c.value!)}`).join(" + ")} = ${fmtMoney(total)}`;
      const def = ASSUMPTION_BY_KEY["total_project_cost"];
      const payload = {
        project_id: data.project_id, owner_id: context.userId,
        field_key: def.key, field_label: def.label, category: def.category, unit: def.unit,
        value_numeric: total, value_text: null,
        status: "calculated" as const, formula_text: formula,
        confidence_score: 100, confidence_band: "high" as const,
        ai_reasoning: "Calculated deterministically from the five extracted budget lines.",
      };
      const prevTdc = existingByKey.get("total_project_cost");
      if (prevTdc) {
        await context.supabase.from("assumptions").update({ ...payload, current_version: prevTdc.current_version + 1 }).eq("id", prevTdc.id);
      } else {
        await context.supabase.from("assumptions").insert(payload);
      }
      calculatedKeys.push("total_project_cost");
      auditEntries.push({ field_key: "total_project_cost", status: "calculated", chosen: total });
    }

    // Missing placeholders for every taxonomy key not found
    const missingKeys: string[] = [];
    for (const def of ASSUMPTION_DEFS) {
      if (grouped.has(def.key) || existingByKey.has(def.key) || calculatedKeys.includes(def.key)) continue;
      missingKeys.push(def.key);
      const { data: ins } = await context.supabase.from("assumptions").insert({
        project_id: data.project_id, owner_id: context.userId,
        field_key: def.key, field_label: def.label, category: def.category, unit: def.unit,
        status: "missing", confidence_score: 0, confidence_band: "missing",
        ai_reasoning: "Not found by Stage 1–3 extraction. Provide manually or upload more docs.",
      }).select().single();
      if (ins) await recordVersion(context, ins, "Created as missing", "Extraction Pipeline");
      auditEntries.push({ field_key: def.key, status: "missing" });
    }

    // The extraction report distinguishes extracted / calculated /
    // default_accepted / missing tiers.
    const allMissingKeys = ASSUMPTION_DEFS
      .filter((def) => !grouped.has(def.key) && !calculatedKeys.includes(def.key) &&
        (!existingByKey.has(def.key) || existingByKey.get(def.key)?.status === "missing"))
      .map((def) => def.key);

    const reportMap = new Map(existingByKey);
    for (const key of grouped.keys()) reportMap.set(key, { field_key: key, status: conflictKeys.includes(key) ? "conflicting" : "extracted" });
    for (const key of calculatedKeys) reportMap.set(key, { field_key: key, status: "calculated" });
    const satisfiedRequired = new Set(requiredKeysSatisfiedBy(reportMap));
    const missingRequired = REQUIRED_KEYS.filter((key) => !satisfiedRequired.has(key) && allMissingKeys.includes(key));

    const report = {
      stage1_candidates: allCandidates.length,
      stage2_classified: classifications.filter((c) => c.field_key !== "ignore").length,
      stage3_inferred_via_alias: inferredCount,
      found: foundKeys.length,
      conflicting: conflictKeys.length,
      calculated: calculatedKeys.length,
      proposed_changes: proposedKeys.length,
      missing: allMissingKeys.length,
      missing_required: missingRequired.map((k) => ASSUMPTION_BY_KEY[k]?.label ?? k),
      conflicts: conflictKeys.map((k) => ASSUMPTION_BY_KEY[k]?.label ?? k),
      can_underwrite: missingRequired.length === 0 && conflictKeys.length === 0,
      entries: auditEntries,
    };

    await auditLog(context, data.project_id, "project", data.project_id, "extract_assumptions", report);
    return report;
  });

// ---------- Approval workflow ----------

// Approval is the ONLY door into the engine: LLM-classified suggestions live
// in the review queue, and an analyst action propagates them here into the
// engine-readable tables with status='approved'.
import { TAXONOMY_TO_ENGINE_SCALAR, TAXONOMY_TO_BUDGET_CATEGORY, TAXONOMY_TO_REVENUE_FIELD } from "./taxonomy-engine-map";

async function propagateApprovedToEngine(ctx: any, a: any) {
  const value = a.value_numeric == null ? null : Number(a.value_numeric);
  const scalarKey = TAXONOMY_TO_ENGINE_SCALAR[a.field_key];
  if (scalarKey && value != null) {
    const { error } = await ctx.supabase.from("underwriting_inputs").upsert({
      project_id: a.project_id, owner_id: ctx.userId, key: scalarKey,
      value_numeric: value, source: "analyst", status: "approved",
      source_document_id: a.source_document_id ?? null,
      source_text: a.source_text ?? null,
      approved_by: ctx.userId, approved_at: new Date().toISOString(),
    }, { onConflict: "project_id,key" });
    if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    return;
  }
  const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[a.field_key];
  if (budgetCategory && value != null) {
    await ctx.supabase.from("development_budget").delete()
      .eq("project_id", a.project_id).eq("category", budgetCategory);
    const { error } = await ctx.supabase.from("development_budget").insert({
      project_id: a.project_id, owner_id: ctx.userId, category: budgetCategory,
      label: a.field_label, amount: value, source: "analyst", status: "approved",
      source_document_id: a.source_document_id ?? null, source_text: a.source_text ?? null,
    });
    if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    return;
  }
  const rev = TAXONOMY_TO_REVENUE_FIELD[a.field_key];
  if (rev && value != null) {
    const fieldCol = rev.field === "rent" ? "market_rent_monthly" : rev.field;
    const { data: existing } = await ctx.supabase.from("revenue_program").select("*")
      .eq("project_id", a.project_id).eq("unit_type", rev.unitType).maybeSingle();
    if (existing) {
      const { error } = await ctx.supabase.from("revenue_program").update({
        [fieldCol]: value, status: "approved", source: "analyst",
      }).eq("id", existing.id);
      if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    } else {
      // Partial components (rent or count still 0) are never engine-usable:
      // readiness requires count/SF AND rent before the row counts.
      const { error } = await ctx.supabase.from("revenue_program").insert({
        project_id: a.project_id, owner_id: ctx.userId,
        unit_type: rev.unitType, rent_basis: rev.basis,
        unit_count: rev.basis === "per_sf" ? 1 : 0,
        market_rent_monthly: 0,
        [fieldCol]: value,
        status: "approved", source: "analyst",
        source_document_id: a.source_document_id ?? null, source_text: a.source_text ?? null,
      });
      if (error) throw new Error(`Failed to propagate ${a.field_key}: ${error.message}`);
    }
  }
}

async function demoteEngineRows(ctx: any, a: any) {
  const scalarKey = TAXONOMY_TO_ENGINE_SCALAR[a.field_key];
  if (scalarKey) {
    await ctx.supabase.from("underwriting_inputs").update({ status: "rejected" })
      .eq("project_id", a.project_id).eq("key", scalarKey);
  }
  const budgetCategory = TAXONOMY_TO_BUDGET_CATEGORY[a.field_key];
  if (budgetCategory) {
    await ctx.supabase.from("development_budget").update({ status: "rejected" })
      .eq("project_id", a.project_id).eq("category", budgetCategory);
  }
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "modify", "reject", "needs_review"]),
  value_numeric: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  change_reason: z.string().max(1000).optional(),
});

export const reviewAssumption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: cur, error } = await context.supabase
      .from("assumptions").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const by = await userName(context);
    const newVer = cur.current_version + 1;
    const patch: any = { current_version: newVer };
    if (data.action === "approve" && cur.status === "conflicting") {
      throw new Error(
        "This key has conflicting extracted values. Resolve the conflict (pick one of the documented values or use the conservative option) instead of approving.",
      );
    }
    if (data.action === "approve") {
      patch.status = "approved";
      patch.approved_by = context.userId;
      patch.approved_at = new Date().toISOString();
    } else if (data.action === "modify") {
      patch.status = "modified";
      patch.value_numeric = data.value_numeric ?? cur.value_numeric;
      patch.value_text = data.value_text ?? cur.value_text;
      patch.approved_by = context.userId;
      patch.approved_at = new Date().toISOString();
      // Modified values get high confidence (human-entered)
      patch.confidence_score = 100;
      patch.confidence_band = "high";
    } else if (data.action === "reject") {
      patch.status = "rejected";
    } else {
      patch.status = "needs_review";
    }
    const { data: upd, error: uErr } = await context.supabase.from("assumptions").update(patch).eq("id", data.id).select().single();
    if (uErr) throw new Error(uErr.message);
    await recordVersion(context, upd, data.change_reason || `Status set to ${upd.status} by ${by}`, by);
    await auditLog(context, cur.project_id, "assumption", cur.id, `assumption_${data.action}`, {
      from: { value_numeric: cur.value_numeric, value_text: cur.value_text, status: cur.status },
      to: { value_numeric: upd.value_numeric, value_text: upd.value_text, status: upd.status },
      reason: data.change_reason ?? null,
    });
    // Approval propagates into the engine-readable tables; rejection demotes.
    if (upd.status === "approved" || upd.status === "modified") {
      await propagateApprovedToEngine(context, upd);
    } else if (upd.status === "rejected") {
      await demoteEngineRows(context, upd);
    }
    return upd;
  });

// ---------- Financial engine ----------
//
// REMOVED. The duplicate ad-hoc model (buildModel/recomputeOutputs) that read
// blended occupancy, applied silent `|| 95`-style defaults, and approximated
// IRR geometrically has been deleted — not gated, removed. All underwriting,
// pro-forma, scenario, DSCR, IRR and risk-score values are produced solely by
// runFullUnderwriting (underwriting.functions.ts) over the deterministic
// engine in src/lib/engine, fed exclusively by approved/default_accepted rows.

// ---------- Decision log ----------

export const recordDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    project_id: z.string().uuid(),
    decision: z.enum(["approve", "approve_with_conditions", "reject"]),
    rationale: z.string().max(5000),
    conditions: z.string().max(5000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const by = await userName(context);
    const { data: row, error } = await context.supabase.from("decision_logs").insert({
      project_id: data.project_id, owner_id: context.userId, user_id: context.userId, user_name: by,
      decision: data.decision, rationale: data.rationale, conditions: data.conditions ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    await auditLog(context, data.project_id, "decision", row.id, "ic_decision", { decision: data.decision });
    return row;
  });

// ---------- Readiness ----------

export const getReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("assumptions")
      .select("field_key,status,confidence_score,confidence_band").eq("project_id", data.project_id);
    const map = new Map((rows ?? []).map((r) => [r.field_key, r]));
    const required = ASSUMPTION_DEFS.filter((d) => d.required);
    const total = ASSUMPTION_DEFS.length;
    const approved = (rows ?? []).filter((r) => r.status === "approved" || r.status === "modified").length;
    const satisfiedRequired = new Set(requiredKeysSatisfiedBy(map));
    const missingReq = required.filter((d) => !satisfiedRequired.has(d.key));
    const avgConfidence = (rows ?? []).reduce((s, r) => s + (r.confidence_score || 0), 0) / Math.max(rows?.length ?? 1, 1);
    const completenessPct = Math.round((approved / total) * 100);
    const requiredPct = Math.round(((required.length - missingReq.length) / required.length) * 100);
    const score = Math.round(0.6 * requiredPct + 0.3 * completenessPct + 0.1 * avgConfidence);
    return { score, approved, total, missing_required: missingReq.map((d) => d.label), avg_confidence: Math.round(avgConfidence), completeness_pct: completenessPct, required_pct: requiredPct };
  });
