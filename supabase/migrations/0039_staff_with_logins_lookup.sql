-- ============================================================================
-- Betterservice Te Puke — which staff can actually sign in (26 Aug 2026)
--
-- Why: a staff row and an Auth account are two separate things, matched on email.
-- When they don't match, the person signs in successfully and then sees an empty,
-- broken app with no error. That is exactly what happened to Craig, and nothing in
-- the UI showed it. This lets the Staff page display the truth.
--
-- Returns ONLY the email and a yes/no. No password hashes, no tokens, no auth
-- metadata — the app never needs those and must not be able to read them.
--
-- Owner-gated: staff email addresses and who can access the system are owner-level
-- information, matching how the rest of the admin surface is protected.
-- ============================================================================
create or replace function public.staff_with_logins()
returns table (email text, has_login boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_owner() then
    raise exception 'Not authorized: owners only';
  end if;

  return query
    select s.email::text,
           exists (select 1 from auth.users u where lower(u.email) = lower(s.email)) as has_login
    from public.staff s
    where s.email is not null;
end;
$function$;

revoke execute on function public.staff_with_logins() from public, anon;
grant  execute on function public.staff_with_logins() to authenticated;
