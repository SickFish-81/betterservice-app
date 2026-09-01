-- ============================================================================
-- Betterservice ATV — add a supplier without leaving the job (1 Sep 2026)
--
-- Ordering a part in meant the supplier had to already exist under Admin →
-- Suppliers. At the counter, with a customer waiting, that is a dead end: you
-- either stop and go set the supplier up, or you leave it blank and lose the
-- link to their invoice later.
--
-- So the name is typed and resolved here: an existing supplier is matched
-- (case-insensitive, ignoring stray spaces) and only a genuinely new one is
-- created. That keeps it fast without breeding "Repco", "repco " and "REPCO"
-- as three separate suppliers.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.find_or_create_supplier(p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   uuid;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  if v_name = '' then return null; end if;

  select id into v_id from suppliers
   where lower(btrim(name)) = lower(v_name)
   order by created_at nulls last
   limit 1;

  if v_id is null then
    insert into suppliers (name) values (left(v_name, 120)) returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.find_or_create_supplier(text) from public, anon;
grant  execute on function public.find_or_create_supplier(text) to authenticated;
