# Agir Local Setup

## Human prerequisite

Create a new Supabase project in the product owner's own Supabase organization before pushing any migrations. Use a region near users, preferably US-West or Canada. Do not reuse the Lovable-managed project. Collect the project ref, publishable key, service-role key, and database password.

## Local-first workflow

```bash
npm install
cp .env.example .env.local
supabase start
supabase db reset
npm run dev
```

`VITE_SUPABASE_URL` should match `SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY` should match `SUPABASE_PUBLISHABLE_KEY`. The `VITE_` copies are required because the browser-side Supabase client can only read Vite-exposed environment variables.

After local migrations and tests pass, link and push to the owned project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

## Backup before remote migration

```bash
mkdir -p backups
supabase db dump --linked --file backups/pre-development-engine.sql
```

## Verification

```bash
npm run test
npm run build
```
