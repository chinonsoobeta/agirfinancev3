import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { reconcileDevelopmentInputs } from "./reconcile.server";

const DocProjectSchema = z.object({
  project_id: z.string().uuid(),
  document_id: z.string().uuid(),
});

async function downloadDocument(context: any, documentId: string) {
  const { data: doc, error } = await context.supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(error.message);
  const { downloadDocumentBlob } = await import("./storage-download.server");
  const dl = await downloadDocumentBlob(context.supabase, doc.storage_path);
  if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "Unable to download document.");
  return { doc, buffer: await dl.data.arrayBuffer() };
}

export const parseBudget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DocProjectSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { doc, buffer } = await downloadDocument(context, data.document_id);
    const { parseBudgetWorkbook } = await import("./parsers/budget.server");
    const parsed = parseBudgetWorkbook(buffer);
    if (parsed.inserted.length) {
      // Suggestions only: status='extracted' is not engine-readable until an
      // analyst approves.
      await context.supabase.from("development_budget").insert(parsed.inserted.map((row) => ({
        project_id: data.project_id,
        owner_id: context.userId,
        category: row.category,
        label: row.label,
        amount: row.amount,
        source: "extracted",
        status: "extracted",
        source_document_id: doc.id,
        source_text: row.sourceCellRef,
      })));
    }
    return parsed;
  });

export const parseRentRoll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DocProjectSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { doc, buffer } = await downloadDocument(context, data.document_id);
    const { parseRentRollWorkbook } = await import("./parsers/rent-roll.server");
    const parsed = parseRentRollWorkbook(buffer);
    if (parsed.inserted.length) {
      // One row per component, each with its own occupancy; suggestions only.
      await context.supabase.from("revenue_program").insert(parsed.inserted.map((row) => ({
        project_id: data.project_id,
        owner_id: context.userId,
        unit_type: row.unitType,
        unit_count: row.unitCount,
        avg_sf: row.avgSf,
        market_rent_monthly: row.rent,
        rent_basis: row.rentBasis,
        occupancy_pct: row.occupancyPct,
        source: "extracted",
        status: "extracted",
        source_document_id: doc.id,
        source_text: row.sourceCellRef,
      })));
    }
    return parsed;
  });

export const runReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => z.object({ project_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: project }, { data: budget }, { data: revenue }] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", data.project_id).single(),
      context.supabase.from("development_budget").select("*").eq("project_id", data.project_id),
      context.supabase.from("revenue_program").select("*").eq("project_id", data.project_id),
    ]);
    const budgetTotal = (budget ?? []).reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
    const computedGpr = (revenue ?? []).reduce((sum: number, row: any) => {
      const sf = Number(row.avg_sf ?? 0);
      const rent = Number(row.market_rent_monthly ?? 0);
      const count = Number(row.unit_count ?? 0);
      return sum + count * (row.rent_basis === "per_sf" ? sf * rent : rent) * 12;
    }, 0);
    const flags = reconcileDevelopmentInputs({
      budgetTotal,
      statedTdc: Number(project?.acquisition_cost ?? 0) + Number(project?.construction_cost ?? 0),
      equity: Number(project?.equity_amount ?? 0),
      loan: Number(project?.debt_amount ?? 0),
      statedRevenue: Number(project?.revenue_forecast ?? 0),
      computedGpr,
    });
    await context.supabase.from("reconciliation_flags").delete().eq("project_id", data.project_id);
    if (flags.length) {
      await context.supabase.from("reconciliation_flags").insert(flags.map((flag) => ({
        project_id: data.project_id,
        owner_id: context.userId,
        ...flag,
      })));
    }
    return { flags };
  });
