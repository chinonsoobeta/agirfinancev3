# Vercel Deployment

This app deploys as a TanStack Start/Nitro app using Vercel's Build Output API.

## Vercel settings

- Framework preset: Other
- Install command: `npm install`
- Build command: `npm run build`
- Output directory: leave blank

The build generates `.vercel/output`, which Vercel deploys directly.

## Environment variables

Add these in Vercel Project Settings -> Environment Variables for Production, Preview, and Development as needed:

```bash
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
ANTHROPIC_API_KEY=
AGIR_AI_MODEL=claude-sonnet-4-6
```

`VITE_SUPABASE_URL` should equal `SUPABASE_URL`.
`VITE_SUPABASE_PUBLISHABLE_KEY` should equal `SUPABASE_PUBLISHABLE_KEY`.

Never expose `SUPABASE_SERVICE_ROLE_KEY` with a `VITE_` prefix.

## Supabase auth URLs

After the first Vercel deployment, copy the Vercel URL and update Supabase:

Supabase Dashboard -> Authentication -> URL Configuration

- Site URL: `https://your-project.vercel.app`
- Redirect URLs:
  - `https://your-project.vercel.app/**`
  - `http://localhost:8080/**`
  - `http://127.0.0.1:8080/**`

If you use Google sign-in, configure Google as a Supabase OAuth provider and add the Supabase callback URL shown in the Supabase provider screen to Google Cloud Console.

## Database and storage

Before testing production:

1. Make sure all migrations in `supabase/migrations` have been applied to the Supabase project.
2. Make sure the `documents` storage bucket exists.
3. Upload the shared Harbour demo files if you want the seeded Harbour demo to work for every account:

```bash
node scripts/upload-shared-harbour-docs.mjs
```

That script requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` locally.

## Verify after deploy

1. Sign up or sign in.
2. Create or seed the Harbour Centre demo.
3. Open the project and run extraction.
4. Resolve the exit-cap conflict or choose conservative.
5. Accept available defaults.
6. Run underwriting.

Expected behavior: server functions should return JSON errors, not HTML payloads, and unauthenticated actions should fail as `401`.
