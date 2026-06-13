-- Fail-closed underwriting: every engine-readable row carries an explicit
-- status. The engine loader selects ONLY status IN ('approved','default_accepted');
-- extracted / conflicting / proposed rows are review-queue suggestions and are
-- invisible to the engine.

DO $$ BEGIN
  CREATE TYPE public.engine_input_status AS ENUM (
    'proposed',         -- suggestion (LLM-classified or re-extraction against an approved key)
    'extracted',        -- deterministic extraction, awaiting analyst review
    'conflicting',      -- >=2 distinct extracted values; blocks readiness until resolved
    'approved',         -- analyst-approved; engine-readable
    'default_accepted', -- static DEFAULTS value accepted by explicit analyst action; engine-readable
    'calculated',       -- derived deterministically from other approved rows (with formula_text)
    'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scalar engine inputs
ALTER TABLE public.underwriting_inputs
  ADD COLUMN IF NOT EXISTS status public.engine_input_status NOT NULL DEFAULT 'extracted',
  ADD COLUMN IF NOT EXISTS value_text TEXT,
  ADD COLUMN IF NOT EXISTS formula_text TEXT,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT,
  ADD COLUMN IF NOT EXISTS conflict_values JSONB,
  ADD COLUMN IF NOT EXISTS source_text TEXT;

-- Backfill: analyst-entered rows were reviewed; extracted stay pending review;
-- silently-applied defaults are demoted to proposals (defaults require consent).
UPDATE public.underwriting_inputs SET status = 'approved' WHERE source = 'analyst';
UPDATE public.underwriting_inputs SET status = 'extracted' WHERE source = 'extracted';
UPDATE public.underwriting_inputs SET status = 'proposed' WHERE source = 'default';

-- Budget lines
ALTER TABLE public.development_budget
  ADD COLUMN IF NOT EXISTS status public.engine_input_status NOT NULL DEFAULT 'extracted';
UPDATE public.development_budget SET status = 'approved' WHERE source = 'analyst';
UPDATE public.development_budget SET status = 'extracted' WHERE source = 'extracted';
UPDATE public.development_budget SET status = 'proposed' WHERE source = 'default';

-- Revenue components: one row per component, each with its own occupancy.
ALTER TABLE public.revenue_program
  ADD COLUMN IF NOT EXISTS status public.engine_input_status NOT NULL DEFAULT 'extracted',
  ADD COLUMN IF NOT EXISTS occupancy_pct NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS source public.assumption_source_kind NOT NULL DEFAULT 'extracted',
  ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_text TEXT;
-- Pre-existing rows were analyst-seeded reference data.
UPDATE public.revenue_program SET status = 'approved';

-- Review-queue table: side-by-side conflict values and derived-value formulas.
ALTER TABLE public.assumptions
  ADD COLUMN IF NOT EXISTS conflict_values JSONB,
  ADD COLUMN IF NOT EXISTS formula_text TEXT;

-- Review-queue statuses for the derived/default tiers (used at runtime only;
-- not referenced in this transaction).
ALTER TYPE public.assumption_status ADD VALUE IF NOT EXISTS 'default_accepted';
ALTER TYPE public.assumption_status ADD VALUE IF NOT EXISTS 'calculated';
