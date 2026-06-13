DO $$ BEGIN
  CREATE TYPE public.deal_type AS ENUM ('development', 'acquisition');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.development_budget_category AS ENUM ('land', 'hard', 'soft', 'contingency', 'financing_interest', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.assumption_source_kind AS ENUM ('extracted', 'analyst', 'default');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.rent_basis AS ENUM ('per_unit', 'per_sf');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.cash_flow_line_key AS ENUM ('equity', 'construction', 'interest', 'gross_revenue', 'egi', 'opex', 'noi', 'debt_service', 'levered_cf', 'sale_proceeds', 'loan_payoff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reconciliation_severity AS ENUM ('info', 'warning', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deal_type public.deal_type NOT NULL DEFAULT 'development';

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS extraction_error TEXT;

ALTER TABLE public.scenarios
  ADD COLUMN IF NOT EXISTS exit_cap_rate_pct NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS rent_growth_pct NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS occupancy_pct NUMERIC(6,2);

ALTER TABLE public.investment_memos
  ADD COLUMN IF NOT EXISTS verification_report JSONB;

DROP POLICY IF EXISTS "profiles_select_all_auth" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE TABLE IF NOT EXISTS public.development_budget (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category public.development_budget_category NOT NULL,
  label TEXT NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  source public.assumption_source_kind NOT NULL DEFAULT 'default',
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  source_text TEXT,
  confidence NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.development_budget TO authenticated;
GRANT ALL ON public.development_budget TO service_role;
ALTER TABLE public.development_budget ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "development_budget_owner_all" ON public.development_budget;
CREATE POLICY "development_budget_owner_all" ON public.development_budget FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS development_budget_project_idx ON public.development_budget(project_id);

CREATE TABLE IF NOT EXISTS public.revenue_program (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_type TEXT NOT NULL,
  unit_count INTEGER NOT NULL,
  avg_sf NUMERIC(12,2),
  market_rent_monthly NUMERIC(18,2) NOT NULL,
  rent_basis public.rent_basis NOT NULL DEFAULT 'per_unit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_program TO authenticated;
GRANT ALL ON public.revenue_program TO service_role;
ALTER TABLE public.revenue_program ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "revenue_program_owner_all" ON public.revenue_program;
CREATE POLICY "revenue_program_owner_all" ON public.revenue_program FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS revenue_program_project_idx ON public.revenue_program(project_id);

CREATE TABLE IF NOT EXISTS public.underwriting_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_numeric NUMERIC,
  source public.assumption_source_kind NOT NULL DEFAULT 'default',
  source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.underwriting_inputs TO authenticated;
GRANT ALL ON public.underwriting_inputs TO service_role;
ALTER TABLE public.underwriting_inputs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "underwriting_inputs_owner_all" ON public.underwriting_inputs;
CREATE POLICY "underwriting_inputs_owner_all" ON public.underwriting_inputs FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS underwriting_inputs_project_idx ON public.underwriting_inputs(project_id);

CREATE TABLE IF NOT EXISTS public.cash_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_key TEXT NOT NULL DEFAULT 'base',
  period_year INTEGER NOT NULL,
  line_key public.cash_flow_line_key NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, scenario_key, period_year, line_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_flows TO authenticated;
GRANT ALL ON public.cash_flows TO service_role;
ALTER TABLE public.cash_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cash_flows_owner_all" ON public.cash_flows;
CREATE POLICY "cash_flows_owner_all" ON public.cash_flows FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS cash_flows_project_idx ON public.cash_flows(project_id, scenario_key);

CREATE TABLE IF NOT EXISTS public.reconciliation_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL,
  severity public.reconciliation_severity NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  expected NUMERIC,
  actual NUMERIC,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reconciliation_flags TO authenticated;
GRANT ALL ON public.reconciliation_flags TO service_role;
ALTER TABLE public.reconciliation_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reconciliation_flags_owner_all" ON public.reconciliation_flags;
CREATE POLICY "reconciliation_flags_owner_all" ON public.reconciliation_flags FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX IF NOT EXISTS reconciliation_flags_project_idx ON public.reconciliation_flags(project_id);

