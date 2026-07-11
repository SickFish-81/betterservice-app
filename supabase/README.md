# Database (Supabase)

Project: `vdwssiefdhmepdgkuoxd` (region ap-southeast-1).

## What's here
- `migrations/0001_schema_baseline.sql` — full schema, RLS and policies, captured
  from the live database on 2026-07-09. Run on an **empty** database to reproduce.
- `migrations/0002_launch_hardening_2026_07_09.sql` — the launch-readiness security
  fixes applied on 2026-07-09 (already included in the baseline; kept as a record).

## Edge functions
- `functions/send-invoice` — files the invoice PDF (private bucket) and emails it
  via Resend. Verifies the caller is an owner who can send invoices.
- `functions/send-reminder` — emails a service reminder via Resend. Verifies the
  caller is approved staff.

## Going forward
The database now lives in version control, but Supabase is still the source of truth.
When you change the schema, add a new numbered migration file here so the change is
reviewed and backed up like code. With the Supabase CLI you can also run
`supabase link` then `supabase db pull` to regenerate a baseline automatically.

Secrets (never commit these): `RESEND_API_KEY` and the Supabase keys live in
Supabase project settings / Vercel env vars, not in this repo.
