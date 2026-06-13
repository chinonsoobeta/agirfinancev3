// Seed the Harbour Centre demo project from the VERIFIED extraction register
// (golden fixture 2). The previous seed embodied the fabricated deal this
// codebase is hardened against (invented 18M/86M budget, a 5.35% exit cap that
// appears in no document, phantom other income); it has been replaced with the
// hand-verified values, including the documented exit-cap conflict and the
// genuinely-missing keys that must block underwriting until defaults are
// accepted.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  HARBOUR_BUDGET_LINES,
  HARBOUR_EXIT_CAP_CONFLICT,
  HARBOUR_REVENUE_COMPONENTS,
  HARBOUR_SCALARS,
} from "./engine/harbour-fixture";

const DEMO_FILES = [
  { name: "Harbour_Centre_Sponsor_Summary.pdf", category: "Sponsor", path: "demo/harbour-centre/Sponsor_Summary.pdf", size: 1696, type: "application/pdf" },
  { name: "Harbour_Centre_Market_Study.pdf", category: "Market Study", path: "demo/harbour-centre/Market_Study.pdf", size: 1733, type: "application/pdf" },
  { name: "Harbour_Centre_Broker_Opinion.pdf", category: "Appraisal", path: "demo/harbour-centre/Broker_Opinion.pdf", size: 1644, type: "application/pdf" },
  { name: "Harbour_Centre_Lender_Term_Sheet.pdf", category: "Loan Package", path: "demo/harbour-centre/Lender_Term_Sheet.pdf", size: 1789, type: "application/pdf" },
  { name: "Harbour_Centre_Construction_Budget.xlsx", category: "Budget", path: "demo/harbour-centre/Construction_Budget.xlsx", size: 4949, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { name: "Harbour_Centre_Rent_Roll.xlsx", category: "Financial Model", path: "demo/harbour-centre/Rent_Roll.xlsx", size: 4995, type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
];

export const seedHarbourCentre = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Create the project. Project-level columns mirror the verified register;
    // they feed the dashboard estimator only — underwriting reads exclusively
    // from the provenance rows seeded below.
    const { data: project, error } = await context.supabase.from("projects").insert({
      owner_id: context.userId,
      name: "Harbour Centre",
      location: "Mixed-use waterfront",
      type: "mixed_use",
      status: "underwriting",
      deal_type: "development",
      acquisition_cost: 34_500_000,
      construction_cost: 162_000_000,
      revenue_forecast: 9_404_640,
      debt_amount: 162_500_000,
      equity_amount: 50_000_000,
      interest_rate: 6.25,
      notes: "Demo deal: 220-unit residential tower over 18k SF retail and 32k SF office. Exit cap is conflicted (4.75% broker vs 5.25% lender); expense ratio, hold period and selling costs are absent from the documents.",
    }).select().single();
    if (error) throw new Error(error.message);

    // Link existing storage paths as documents (no re-upload)
    for (const f of DEMO_FILES) {
      await context.supabase.from("documents").insert({
        owner_id: context.userId, project_id: project.id,
        name: f.name, category: f.category, storage_path: f.path,
        file_type: f.type, size_bytes: f.size,
      });
    }

    await context.supabase.from("development_budget").insert(HARBOUR_BUDGET_LINES.map((row) => ({
      project_id: project.id,
      owner_id: context.userId,
      category: row.category,
      label: row.label,
      amount: row.amount,
      source: "extracted",
      status: row.status,
    })));

    await context.supabase.from("revenue_program").insert(HARBOUR_REVENUE_COMPONENTS.map((row) => ({
      project_id: project.id,
      owner_id: context.userId,
      unit_type: row.unit_type,
      unit_count: row.unit_count,
      avg_sf: row.avg_sf,
      market_rent_monthly: row.rent,
      rent_basis: row.rent_basis,
      occupancy_pct: row.occupancy_pct,
      source: "extracted",
      status: row.status,
    })));

    await context.supabase.from("underwriting_inputs").insert(HARBOUR_SCALARS.map((row) => ({
      project_id: project.id,
      owner_id: context.userId,
      key: row.key,
      value_numeric: row.value_numeric,
      source: "extracted",
      status: row.status,
      conflict_values: row.conflict_values ?? null,
      approved_by: row.status === "approved" ? context.userId : null,
      approved_at: row.status === "approved" ? new Date().toISOString() : null,
    })));

    await context.supabase.from("activities").insert({
      project_id: project.id, user_id: context.userId,
      activity_type: "project_created",
      description: `Seeded Harbour Centre demo with 6 source documents; exit cap conflict ${HARBOUR_EXIT_CAP_CONFLICT.values.map((v) => v.value).join("% vs ")}% pending resolution`,
    });

    return { project_id: project.id };
  });
