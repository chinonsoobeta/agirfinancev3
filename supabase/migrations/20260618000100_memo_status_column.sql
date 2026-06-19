-- Memo generation schema: ensure investment_memos carries the provenance
-- verification report and a status. verification_report was added earlier; both
-- are declared idempotently here so a fresh database is complete. Owner RLS
-- (memos_owner_all, FOR ALL) already covers insert/select/update/delete.

ALTER TABLE public.investment_memos
  ADD COLUMN IF NOT EXISTS verification_report JSONB;

ALTER TABLE public.investment_memos
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'generated';
