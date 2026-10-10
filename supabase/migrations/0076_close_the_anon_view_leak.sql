-- 0076_close_the_anon_view_leak.sql
--
-- WHAT WAS WRONG
--
-- `invoices_unsent` was readable by the `anon` role — that is, by anyone holding
-- the publishable key, which ships inside the browser bundle of a public site.
-- It exposes invoice_number, total, status, issued_date, the CUSTOMER'S NAME and
-- the CUSTOMER'S EMAIL. `staff_push_status` was readable the same way: every
-- active staff member's name and how many devices they have registered.
--
-- The underlying tables were never the problem. invoices, customers, job_cards,
-- staff and push_subscriptions all have RLS on, all have policies, and anon has
-- no SELECT on any of them. The leak was the views, and only the views.
--
-- HOW IT HAPPENED — worth understanding, because it will recur otherwise
--
-- A Postgres view normally runs with the privileges of the view's OWNER, which
-- here is `postgres`. It therefore sails past the caller's grants and past RLS.
-- `security_invoker = true` turns that off and makes the view run as whoever is
-- querying it, which is what you almost always want over RLS-protected tables.
--
--   0066 created invoices_unsent WITH (security_invoker = true).   Correct.
--   0072 recreated it WITH (security_invoker = true).              Still correct.
--   0073 recreated it with no WITH clause at all.
--
-- `create or replace view` RESETS the view's options when none are given. So a
-- migration about draft invoices silently removed a protection that two earlier
-- migrations had set on purpose. No error, no warning, nine days exposed.
--
-- THE LESSON for the next person: if you `create or replace view` any of these,
-- you MUST repeat `with (security_invoker = true)`. Leaving it off is not a
-- no-op, it is a revert.
--
-- SECOND TRAP, found while writing this file
--
-- The first version of this migration did `revoke ... from anon, authenticated`
-- and its own closing assertion failed: the functions were still callable. The
-- reason is that Postgres grants EXECUTE on every new function to PUBLIC by
-- default. Their ACLs read:
--
--     =X/postgres            <- the empty grantee IS "PUBLIC"
--     postgres=X/postgres
--     anon=X/postgres
--     authenticated=X/postgres
--
-- Revoking the named roles leaves `=X/postgres` untouched, and PUBLIC includes
-- anon, so nothing changes. You have to revoke from PUBLIC as well. Compare
-- `is_owner()`, which someone had already cleaned up properly — it has no PUBLIC
-- line at all. That is the shape to match.
--
-- This is the third time grants on this project have quietly come undone (see
-- DECISIONS.md). The first two were revoked grants reappearing; this one is a
-- view option dropped by an unrelated migration. Same shape, new mechanism.

begin;

-- ---------------------------------------------------------------------------
-- 1. invoices_unsent — restore what 0066 and 0072 both intended.
--
-- `alter view ... set` rather than recreating it: the view's SQL is correct and
-- current (0073's draft-aware version), only the option was lost. Recreating it
-- would mean copying 25 lines of SELECT for no reason, in the one view that
-- tells Craig which invoices have not been paid for.
--
-- Verified before applying, acting as a real signed-in owner with the change in
-- place: the view still returns its rows. invoices_select, customers.staff_all
-- and job_cards.staff_all are all `is_approved_staff()`, which every real user
-- of /emails already satisfies. What changes is that anon gets nothing.
-- ---------------------------------------------------------------------------
alter view public.invoices_unsent set (security_invoker = true);
revoke all on public.invoices_unsent from public, anon;

-- ---------------------------------------------------------------------------
-- 2. staff_push_status — revoke anon, but DELIBERATELY left owner-run.
--
-- Flipping security_invoker here would be wrong, and quietly so. The view counts
-- rows in push_subscriptions, whose select policy is `staff_id =
-- current_staff_id()` — own rows only. Run as the caller, the device count would
-- read 0 for every staff member except the person looking, and the page would be
-- confidently wrong rather than visibly broken. That is a worse failure than the
-- one being fixed.
--
-- Nothing in the app reads this view today (checked 10 Oct 2026: no reference
-- outside migration 0070), so there is no behaviour to preserve and no reason to
-- redesign it now. Closing it to anon is the whole fix. Staff keep access, and
-- staff names are already visible to any approved staff via staff_select.
--
-- The database linter will keep flagging this view as SECURITY DEFINER. That is
-- expected, and this comment is the answer. If a push-status page is ever built,
-- do the counting in a security definer FUNCTION gated on is_owner() and make
-- the view security_invoker — do not loosen the policy on push_subscriptions.
-- ---------------------------------------------------------------------------
revoke all on public.staff_push_status from public, anon;

comment on view public.staff_push_status is
  'Active staff and how many push devices each has registered. Runs as its owner '
  'ON PURPOSE: the count reads push_subscriptions, whose RLS is own-rows-only, so a '
  'security_invoker version would report 0 for everyone but the caller. Not granted '
  'to anon. Unused by the app as at 10 Oct 2026 — see migration 0076.';

-- ---------------------------------------------------------------------------
-- 3. Trigger functions do not belong in the REST API.
--
-- PostgREST exposes every function in `public` as an RPC endpoint, trigger
-- functions included, and eight of them were callable by anon. Postgres refuses
-- to invoke a trigger function as a plain call, so this was not exploitable —
-- but "not exploitable" is a property of the error message, not of the design,
-- and there is no version of this app where an anonymous visitor should be able
-- to reach `link_staff_to_existing_auth_user`.
--
-- REVOKING EXECUTE DOES NOT STOP TRIGGERS FIRING. Postgres checks EXECUTE when
-- CREATE TRIGGER runs, not on every fire, and trigger bodies run in the table
-- owner's context regardless of who caused the write. Verified before applying:
-- in a rolled-back transaction, with EXECUTE revoked from all 21 trigger
-- functions, an update to an invoice's issued_date still had
-- trg_invoice_due_date recompute its due date (15 Jan -> 18 Jan on days_3).
--
-- A loop rather than a list, so a trigger function added next month is covered
-- by re-running this, and so no name can be mistyped.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
  n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    n := n + 1;
  end loop;
  raise notice '0076: revoked EXECUTE on % trigger function(s)', n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. invoice_credited_total — a signed-in-only lookup.
--
-- It takes an invoice id and returns how much has been credited against it. Not
-- catastrophic alone, but it is a money figure answering to a guessed uuid, and
-- no public page needs it. Nothing calls it over the API at all — its only
-- callers are inside 0065's own SQL — so `authenticated` keeps EXECUTE purely so
-- that those internal calls cannot be broken from a direction I have not traced.
--
-- submit_booking_request KEEPS its anon grant: that one is the public booking
-- form on the website and must stay reachable without signing in. The assertion
-- at the bottom of this file guards exactly that.
-- ---------------------------------------------------------------------------
revoke all on function public.invoice_credited_total(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. push_subscriptions — anon held SELECT for no reason.
--
-- RLS would have returned nothing anyway (current_staff_id() is null without a
-- session), so this is belt and braces, not a hole being closed.
-- ---------------------------------------------------------------------------
revoke all on table public.push_subscriptions from public, anon;

-- ---------------------------------------------------------------------------
-- 6. invoice_due_date — pin the search_path.
--
-- A SECURITY DEFINER function with a mutable search_path can be made to resolve
-- an unqualified name to an attacker-controlled object. This one is the trigger
-- behind `trg_invoice_due_date`, the function that decides when an invoice is
-- due, so it is the last one that should resolve to something else.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'invoice_due_date'
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
    raise notice '0076: pinned search_path on %', f.sig;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Prove it, in the same transaction that did it.
--
-- A migration that silently fails to achieve its point is how this hole was
-- opened. These assertions already earned their keep once: the first version of
-- this file revoked only from the named roles and this block caught it, so
-- nothing was half-applied.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'invoices_unsent'
      and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ) then
    raise exception '0076: invoices_unsent did not end up with security_invoker=true';
  end if;

  if has_table_privilege('anon', 'public.invoices_unsent', 'select') then
    raise exception '0076: anon can still select from invoices_unsent';
  end if;
  if has_table_privilege('anon', 'public.staff_push_status', 'select') then
    raise exception '0076: anon can still select from staff_push_status';
  end if;
  if has_table_privilege('anon', 'public.push_subscriptions', 'select') then
    raise exception '0076: anon can still select from push_subscriptions';
  end if;

  if has_function_privilege('anon', 'public.invoice_credited_total(uuid)', 'execute') then
    raise exception '0076: anon can still execute invoice_credited_total';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prorettype = 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception '0076: a trigger function is still callable over the API';
  end if;

  -- The public booking form must still work.
  if not has_function_privilege('anon',
      'public.submit_booking_request(text,text,text,text,text,text,text,text,boolean,text,text,text,text)',
      'execute') then
    raise exception '0076: the public booking form lost its anon grant';
  end if;

  -- And signed-in staff must not have lost the report.
  if not has_table_privilege('authenticated', 'public.invoices_unsent', 'select') then
    raise exception '0076: authenticated lost SELECT on invoices_unsent';
  end if;

  raise notice '0076: all checks passed';
end $$;

commit;
