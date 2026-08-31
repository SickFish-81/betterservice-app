-- ============================================================================
-- Betterservice ATV — enquiries vs bookings (31 Aug 2026)
--
-- "Can you work on a 1998 Suzuki?" is not the same as "here is my bike, please
-- service it". Both come through the same form, but they need telling apart:
-- one wants an answer, the other becomes a job card. Same table, one column.
--
-- Existing rows are bookings, which is what they were.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.booking_requests
  add column if not exists kind text not null default 'booking';

alter table public.booking_requests drop constraint if exists booking_requests_kind_check;
alter table public.booking_requests add constraint booking_requests_kind_check
  check (kind in ('booking', 'enquiry'));

-- An enquiry doesn't have to say what's wrong with a machine — it might be a
-- question about whether Craig works on something at all. So p_problem is no
-- longer required when the kind is 'enquiry'.
create or replace function public.submit_booking_request(
  p_contact          text,
  p_email            text,
  p_problem          text,
  p_company          text default null,
  p_phone            text default null,
  p_machine_type     text default null,
  p_machine_make     text default null,
  p_machine_model    text default null,
  p_pickup           boolean default false,
  p_pickup_address   text default null,
  p_notes            text default null,
  p_trap             text default null,
  p_kind             text default 'booking'
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kind text := case when lower(coalesce(p_kind, 'booking')) = 'enquiry' then 'enquiry' else 'booking' end;
begin
  -- Honeypot: a bot fills every field it finds. Accept quietly, write nothing.
  if coalesce(btrim(p_trap), '') <> '' then
    return;
  end if;

  if coalesce(btrim(p_contact), '') = '' then
    raise exception 'Please tell us your name.';
  end if;
  if coalesce(btrim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right — we need it to get back to you.';
  end if;
  if v_kind = 'booking' and coalesce(btrim(p_problem), '') = '' then
    raise exception 'Please tell us what needs doing.';
  end if;
  if v_kind = 'enquiry' and coalesce(btrim(p_problem), '') = '' and coalesce(btrim(p_notes), '') = '' then
    raise exception 'Please tell us what you would like to know.';
  end if;

  if (select count(*) from booking_requests
       where lower(email) = lower(btrim(p_email))
         and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'That is a lot of messages at once — please give Craig a call instead.';
  end if;

  insert into booking_requests (
    kind, company_name, contact_name, phone, email,
    machine_type, machine_make, machine_model,
    reported_problem, pickup_needed, pickup_address, notes
  ) values (
    v_kind,
    nullif(left(btrim(p_company), 120), ''),
    left(btrim(p_contact), 120),
    nullif(left(btrim(p_phone), 40), ''),
    lower(left(btrim(p_email), 200)),
    nullif(left(btrim(p_machine_type), 60), ''),
    nullif(left(btrim(p_machine_make), 60), ''),
    nullif(left(btrim(p_machine_model), 60), ''),
    left(btrim(coalesce(nullif(btrim(p_problem), ''), p_notes, 'Enquiry')), 2000),
    coalesce(p_pickup, false),
    nullif(left(btrim(p_pickup_address), 300), ''),
    nullif(left(btrim(p_notes), 2000), '')
  );
end;
$$;

revoke execute on function public.submit_booking_request(text,text,text,text,text,text,text,text,boolean,text,text,text,text) from public;
grant  execute on function public.submit_booking_request(text,text,text,text,text,text,text,text,boolean,text,text,text,text) to anon, authenticated;

-- The 12-argument version from 0047 is superseded; drop it so there is exactly
-- one function to reason about.
drop function if exists public.submit_booking_request(text,text,text,text,text,text,text,text,boolean,text,text,text);
