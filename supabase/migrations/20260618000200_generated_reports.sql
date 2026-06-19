-- Persisted stakeholder reports. Each row stores the deterministic report model
-- (content_json) and its numeric-provenance verification so the Reports page can
-- show the latest-generated timestamp and re-download without recomputing.

CREATE TABLE IF NOT EXISTS public.generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'generated',
  content_json JSONB NOT NULL,
  verification_report JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS generated_reports_project_idx ON public.generated_reports(project_id);
CREATE INDEX IF NOT EXISTS generated_reports_project_type_idx ON public.generated_reports(project_id, report_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_reports TO authenticated;
GRANT ALL ON public.generated_reports TO service_role;
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "generated_reports_owner_all" ON public.generated_reports;
CREATE POLICY "generated_reports_owner_all" ON public.generated_reports
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
