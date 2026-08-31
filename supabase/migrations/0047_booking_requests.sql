-- ============================================================================
-- Betterservice ATV — public booking requests (31 Aug 2026)
--
-- A form on the website so a customer can book work in without ringing Craig,
-- and so nobody has to retype their details afterwards.
--
-- SECURITY: the public gets NO table access. Anonymous callers can execute
-- exactly one function, submit_booking_request(), which validates and writes a
-- single row. They cannot read that row back, cannot see any other request, and
-- cannot touch customers, machines or job cards. Requests land in a holding pen;
-- a staff member turns one into a real customer + machine + job card with one
-- click. That way a bot can fill this table with junk and never reach real data.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.booking_requests (
  id              uuid primary key default gen_random_uuid(),
  company_name    text,
  contact_name    text not null,
  phone           text,
  email           text not null,
  machine_type    text,
  machine_make    text,
  machine_model   text,
  reported_problem text not null,
  pickup_needed   boolean not null default false,
  pickup_address  text,
  notes           text,
  status          text not null default 'new' check (status in ('new', 'accepted', 'declined')),
  customer_id     uuid references public.customers(id),
  job_card_id     uuid references public.job_cards(id),
  handled_by      uuid,
  handled_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists booking_requests_status_idx on public.booking_requests (status, created_at desc);

alter table public.booking_requests enable row level security;

-- Staff read and update. NOTHING inserts through the table — inserts only ever
-- happen inside submit_booking_request(), which is security definer.
drop policy if exists br_select on public.booking_requests;
create policy br_select on public.booking_requests for select using (is_approved_staff());
drop policy if exists br_update on public.booking_requests;
create policy br_update on public.booking_requests for update using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists br_delete on public.booking_requests;
create policy br_delete on public.booking_requests for delete using (is_owner());

revoke all on public.booking_requests from anon;
grant select, update, delete on public.booking_requests to authenticated;

-- ---------------------------------------------------------------------------
-- The only thing the public can call.
-- ---------------------------------------------------------------------------
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
  p_trap             text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Honeypot. The form has a hidden field a person never sees and never fills;
  -- a bot fills every field it finds. Accept quietly and write nothing, so the
  -- bot has no signal that it was caught.
  if coalesce(btrim(p_trap), '') <> '' then
    return;
  end if;

  if coalesce(btrim(p_contact), '') = '' then
    raise exception 'Please tell us your name.';
  end if;
  if coalesce(btrim(p_email), '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That email address does not look right — we need it to send your invoice.';
  end if;
  if coalesce(btrim(p_problem), '') = '' then
    raise exception 'Please tell us what needs doing.';
  end if;

  -- A crude brake on floods from one address.
  if (select count(*) from booking_requests
       where lower(email) = lower(btrim(p_email))
         and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'That is a lot of bookings at once — please give Craig a call instead.';
  end if;

  insert into booking_requests (
    company_name, contact_name, phone, email,
    machine_type, machine_make, machine_model,
    reported_problem, pickup_needed, pickup_address, notes
  ) values (
    nullif(left(btrim(p_company), 120), ''),
    left(btrim(p_contact), 120),
    nullif(left(btrim(p_phone), 40), ''),
    lower(left(btrim(p_email), 200)),
    nullif(left(btrim(p_machine_type), 60), ''),
    nullif(left(btrim(p_machine_make), 60), ''),
    nullif(left(btrim(p_machine_model), 60), ''),
    left(btrim(p_problem), 2000),
    coalesce(p_pickup, false),
    nullif(left(btrim(p_pickup_address), 300), ''),
    nullif(left(btrim(p_notes), 2000), '')
  );
end;
$$;

revoke execute on function public.submit_booking_request(text,text,text,text,text,text,text,text,boolean,text,text,text) from public;
grant  execute on function public.submit_booking_request(text,text,text,text,text,text,text,text,boolean,text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Turn a request into real records. Matches an existing customer by email so a
-- regular booking online doesn't become a second copy of themselves.
-- ---------------------------------------------------------------------------
create or replace function public.accept_booking_request(p_id uuid)
returns public.job_cards
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r   booking_requests;
  v_customer uuid;
  v_machine  uuid;
  v_job      job_cards;
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;

  select * into r from booking_requests where id = p_id;
  if not found then raise exception 'No such booking request'; end if;
  if r.status <> 'new' then raise exception 'That request has already been dealt with.'; end if;

  select id into v_customer from customers where lower(email) = lower(r.email) limit 1;
  if v_customer is null then
    insert into customers (name, phone, email, address, company_name)
      values (r.contact_name, r.phone, r.email,
              case when r.pickup_needed then r.pickup_address else null end,
              r.company_name)
      returning id into v_customer;
  else
    -- Fill gaps on an existing record, never overwrite what's already there.
    update customers
       set phone        = coalesce(nullif(btrim(phone), ''), r.phone),
           company_name = coalesce(nullif(btrim(company_name), ''), r.company_name)
     where id = v_customer;
  end if;

  if coalesce(r.machine_make, r.machine_model) is not null then
    select id into v_machine from machines
     where customer_id = v_customer
       and coalesce(lower(make), '')  = coalesce(lower(r.machine_make), '')
       and coalesce(lower(model), '') = coalesce(lower(r.machine_model), '')
     limit 1;
    if v_machine is null then
      insert into machines (customer_id, type, make, model)
        values (v_customer, coalesce(r.machine_type, 'ATV'), coalesce(r.machine_make, ''), coalesce(r.machine_model, ''))
        returning id into v_machine;
    end if;
  end if;

  insert into job_cards (customer_id, machine_id, reported_problem, source, notes)
    values (v_customer, v_machine, r.reported_problem, 'Online',
            nullif(concat_ws(E'\n',
              case when r.pickup_needed then 'PICK-UP NEEDED: ' || coalesce(r.pickup_address, '(no address given)') end,
              r.notes), ''))
    returning * into v_job;

  update booking_requests
     set status = 'accepted', customer_id = v_customer, job_card_id = v_job.id,
         handled_at = now(), handled_by = auth.uid()
   where id = p_id;

  return v_job;
end;
$$;

revoke execute on function public.accept_booking_request(uuid) from public, anon;
grant  execute on function public.accept_booking_request(uuid) to authenticated;
