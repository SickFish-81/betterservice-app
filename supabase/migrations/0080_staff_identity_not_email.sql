-- staff.email was doing two unrelated jobs, and clearing it broke the other one.
--
--   1. the login identity - the key the app joined everything on
--   2. the mailbox dispatch email is sent to
--
-- We clear job 2 deliberately when an address hard-bounces, so dispatch stops
-- firing bounces that erode sending reputation for every Betterservice email,
-- invoices included. Doing that silently destroyed job 1. Peni could sign in and
-- was then told "Awaiting approval", while is_approved_staff() said he was
-- approved the whole time - because staff.user_id was populated and correct and
-- only the SQL functions ever looked at it.
--
-- is_owner(), is_approved_staff() and current_staff_id() already matched user_id
-- first. staff_with_logins() did not: it filtered `where s.email is not null`
-- and decided "has a login" by comparing email text. So the Staff page reported
-- that Peni had no login at all, offered "Create login", and the edge function
-- correctly refused with 409 "already has a login".
--
-- This rewrites it to answer the question from the LINK, not from the address:
-- a staff member has a login when their row points at an auth account. It also
-- returns the staff id, so the page can stop keying anything on an email, and
-- the sign-in address wherever it lives - so the Staff page can still show
-- someone's sign-in name after their mailbox has been cleared.

drop function if exists public.staff_with_logins();

create or replace function public.staff_with_logins()
returns table(staff_id uuid, email text, sign_in_email text, has_login boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_owner() then
    raise exception 'Not authorized: owners only';
  end if;

  return query
    select s.id,
           s.email::text,                        -- the mailbox: may be null, on purpose
           coalesce(s.email, u.email)::text,     -- what they actually type to sign in
           (u.id is not null) as has_login
      from public.staff s
      -- user_id first, email only as the fallback for a row with no login linked
      -- yet. Same rule as is_approved_staff(), deliberately: one question, one
      -- answer, in one place.
      left join auth.users u
        on u.id = s.user_id
        or (s.user_id is null and s.email is not null
            and lower(u.email) = lower(s.email));
end;
$function$;

revoke all on function public.staff_with_logins() from public, anon;
grant execute on function public.staff_with_logins() to authenticated;
