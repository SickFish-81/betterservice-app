-- 0034_restrict_anon_table_grants.sql
-- Defense in depth: the anonymous (public) role should not hold table
-- privileges it never needs. RLS already gates access, but standing grants
-- would turn any future RLS misconfiguration into a breach. Strip anon down
-- to exactly what the public website requires: read-only access to the two
-- secondhand tables. Row visibility there stays limited to 'Available'
-- listings by the existing public_read RLS policies.
-- Idempotent: safe to re-run.
revoke all on all tables in schema public from anon;

grant select on public.secondhand_listings to anon;
grant select on public.secondhand_photos  to anon;
