-- ============================================================================
-- Betterservice ATV — scheduled jobs can post to the ledger (1 Sep 2026)
--
-- post_entry() guards itself with is_approved_staff(), which asks "is the
-- logged-in person on the staff list?". That is right for anything a browser
-- does. But the rent run is a scheduled job authenticating with the service
-- key — it is not a person, has no staff row, and was rejected. The invoice
-- insert fires the ledger trigger, the trigger called post_entry, post_entry
-- raised, and the whole transaction rolled back. Hence "Not authorised" and no
-- invoice.
--
-- The service key already bypasses RLS entirely, so anything holding it can
-- write these tables directly. Letting it through this guard grants no new
-- power; it just stops a server job being blocked by a check aimed at browsers.
--
-- post_entry is core money code, so it is NOT retyped here — the migration
-- reads its current definition and swaps the one guard line, which cannot
-- introduce a transcription error into the rest of the function.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.is_backend_job()
returns boolean
language plpgsql
stable
set search_path to 'public'
as $$
begin
  return coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
exception when others then
  return false;   -- no claims, or not json: treat as "not a backend job"
end;
$$;

revoke execute on function public.is_backend_job() from public, anon;
grant  execute on function public.is_backend_job() to authenticated, service_role;

do $patch$
declare
  v_def text;
  v_old text := 'if not is_approved_staff() then raise exception ''Not authorised''; end if;';
  v_new text := 'if not (is_approved_staff() or is_backend_job()) then raise exception ''Not authorised''; end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'post_entry'
   limit 1;

  if v_def is null then
    raise exception 'post_entry() not found — nothing to patch';
  end if;

  if position('is_backend_job()' in v_def) > 0 then
    raise notice 'post_entry already allows backend jobs — nothing to do';
    return;
  end if;

  if position(v_old in v_def) = 0 then
    raise exception 'post_entry guard line not found — check it by hand before re-running';
  end if;

  execute replace(v_def, v_old, v_new);
  raise notice 'post_entry patched to allow scheduled jobs';
end
$patch$;
