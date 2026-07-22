-- 0033_harden_execute_grants_revoke_anon.sql
-- Security hardening: remove anonymous/PUBLIC EXECUTE on all SECURITY DEFINER
-- functions in the public schema. Some grants had reverted to the Postgres
-- default (PUBLIC can execute) because later CREATE OR REPLACE FUNCTION
-- statements reset privileges. This restores the intended lockdown:
--   * trigger helpers -> anon:no  authenticated:no   service_role:yes
--   * business RPCs    -> anon:no  authenticated:yes  service_role:yes
-- Authorization inside each function (is_owner / is_approved_staff) is unchanged.
-- Idempotent: safe to re-run.
do $$
declare r record;
begin
  for r in
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args,
           (p.prorettype = 'pg_catalog.trigger'::regtype) as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prosecdef = true
  loop
    execute format('revoke execute on function public.%I(%s) from public;',  r.proname, r.args);
    execute format('revoke execute on function public.%I(%s) from anon;',     r.proname, r.args);

    if r.is_trigger then
      execute format('revoke execute on function public.%I(%s) from authenticated;', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated;', r.proname, r.args);
    end if;

    execute format('grant execute on function public.%I(%s) to service_role;', r.proname, r.args);
  end loop;
end $$;
