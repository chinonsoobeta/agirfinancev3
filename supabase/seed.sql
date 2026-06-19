-- Maple Heights reference deal seed.
-- Run via `supabase db reset`; replace the owner_id after creating a local auth user.

DO $$
DECLARE
  owner UUID := '00000000-0000-0000-0000-000000000000';
  project UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- The token columns must be '' (not NULL): GoTrue scans them into Go strings
  -- and a NULL fails with "converting NULL to string is unsupported" at sign-in.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', owner, 'authenticated', 'authenticated',
    'maple.heights@example.com',
    crypt('password123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Maple Heights Demo"}'::jsonb,
    now(),
    now(),
    '', '', '', '', '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;

  -- GoTrue requires a matching identity row for password sign-in.
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    owner::text, owner,
    jsonb_build_object('sub', owner::text, 'email', 'maple.heights@example.com', 'email_verified', true),
    'email', now(), now(), now()
  ) ON CONFLICT (provider_id, provider) DO NOTHING;

  INSERT INTO public.projects (
    id, owner_id, name, location, type, status, deal_type,
    acquisition_cost, construction_cost, revenue_forecast, debt_amount, equity_amount, interest_rate, notes
  ) VALUES (
    project, owner, 'Maple Heights', 'Reference Market', 'multifamily', 'underwriting', 'development',
    8500000, 28000000, 3351600, 27625000, 14875000, 6.0,
    'Golden fixture for deterministic development underwriting.'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.development_budget (project_id, owner_id, category, label, amount, source) VALUES
    (project, owner, 'land', 'Land', 8500000, 'analyst'),
    (project, owner, 'hard', 'Hard Costs', 28000000, 'analyst'),
    (project, owner, 'soft', 'Soft Costs', 4000000, 'analyst'),
    (project, owner, 'contingency', 'Contingency', 0, 'analyst'),
    (project, owner, 'financing_interest', 'Financing Interest', 2000000, 'analyst')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.revenue_program (project_id, owner_id, unit_type, unit_count, market_rent_monthly, rent_basis) VALUES
    (project, owner, '1BR', 60, 2200, 'per_unit'),
    (project, owner, '2BR', 50, 2600, 'per_unit'),
    (project, owner, '3BR', 10, 3200, 'per_unit')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.underwriting_inputs (project_id, owner_id, key, value_numeric, source) VALUES
    (project, owner, 'construction_months', 18, 'analyst'),
    (project, owner, 'lease_up_months', 12, 'analyst'),
    (project, owner, 'stabilized_occupancy_pct', 95, 'analyst'),
    (project, owner, 'expense_ratio_pct', 35, 'analyst'),
    (project, owner, 'other_income_annual', 0, 'analyst'),
    (project, owner, 'exit_cap_rate_pct', 5, 'analyst'),
    (project, owner, 'loan_amount', 27625000, 'analyst'),
    (project, owner, 'interest_rate_pct', 6, 'analyst'),
    (project, owner, 'amort_years', 30, 'default'),
    (project, owner, 'io_months', 12, 'default'),
    (project, owner, 'avg_outstanding_factor', 0.55, 'default'),
    (project, owner, 'selling_costs_pct', 0, 'default'),
    (project, owner, 'hold_years', 1, 'default'),
    (project, owner, 'equity_amount', 14875000, 'analyst'),
    (project, owner, 'rent_growth_pct', 0, 'default'),
    (project, owner, 'expense_growth_pct', 0, 'default')
  ON CONFLICT (project_id, key) DO NOTHING;

  -- Make the golden fixture engine-readable. The fail-closed loader selects only
  -- status IN ('approved','default_accepted'); the migration backfill ran before
  -- this seed, so without these updates every row stays 'extracted' and
  -- underwriting is blocked. Analyst values -> approved; defaults -> accepted.
  UPDATE public.development_budget SET status = 'approved' WHERE project_id = project;
  UPDATE public.revenue_program SET status = 'approved' WHERE project_id = project;
  UPDATE public.underwriting_inputs
    SET status = CASE WHEN source = 'analyst'
                      THEN 'approved'::public.engine_input_status
                      ELSE 'default_accepted'::public.engine_input_status END,
        approved_by = CASE WHEN source = 'analyst' THEN owner ELSE NULL END,
        approved_at = now()
    WHERE project_id = project;
END $$;
