-- Presale: a step between the service and Craig's sign-off.
--
-- Ben, 19 Nov 2026: a bike being got ready for resale (or a new rental) is
-- serviced by a mechanic, then goes to Peni to be tidied up, then to Craig.
-- Until now the only hand-off was "Send to Craig", so nothing said "the
-- service itself is done" and the next person to pick the bike up could not
-- tell it had already been serviced.
--
-- THE PATH
--
--   New / In progress --(Service done, pass to Presale)--> Presale
--   Presale           --(Presale done, pass to Craig)----> Ready
--   Ready             --(Craig invoices)-----------------> Invoiced
--
-- Only jobs with needs_presale go through Presale. Everything else goes
-- straight to Ready as before. needs_presale is ticked automatically for a
-- customer with presale_default (Sales Prep Betterservice), and can be
-- ticked on any job by hand.
--
-- No DROP statements: the Supabase tool hangs on them (see open-items).

alter table public.job_cards
  add column if not exists needs_presale boolean not null default false,
  add column if not exists serviced_at  timestamptz,
  add column if not exists presale_at   timestamptz,
  add column if not exists presale_by   uuid references public.staff(id);

alter table public.customers
  add column if not exists presale_default boolean not null default false;

-- "Presale" joins the allowed statuses. (alter table ... drop constraint is
-- fine with the Supabase tool; it's bare DROP statements that hang.)
alter table public.job_cards drop constraint if exists job_cards_status_check;
alter table public.job_cards add constraint job_cards_status_check
  check (status = any (array['New', 'In progress', 'Awaiting parts', 'Presale', 'Ready', 'Invoiced', 'Paid']));

comment on column public.job_cards.needs_presale is 'Goes to Presale (Peni) after the service, before Craig.';
comment on column public.job_cards.serviced_at   is 'When the service was marked done. Set by pass_to_presale and mark_job_ready.';
comment on column public.job_cards.presale_at    is 'When Presale was marked done.';
comment on column public.customers.presale_default is 'New jobs for this customer are ticked for Presale.';

-- New job for a Presale customer: tick it.
create or replace function public.presale_default_for_job()
returns trigger language plpgsql security definer set search_path = public as $$
declare v boolean;
begin
  if not coalesce(new.needs_presale, false) and new.customer_id is not null then
    select c.presale_default into v from customers c where c.id = new.customer_id;
    new.needs_presale := coalesce(v, false);
  end if;
  return new;
end;
$$;
create or replace trigger trg_job_presale_default
  before insert on public.job_cards
  for each row execute function public.presale_default_for_job();

-- Mechanic: the service is done, pass it to Presale.
create or replace function public.pass_to_presale(p_job_id uuid)
returns public.job_cards language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid;
  v_job   job_cards;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  select id into v_staff from staff
   where coalesce(active, true)
     and (user_id = auth.uid() or (user_id is null and lower(email) = lower(auth.email())))
   limit 1;

  update job_cards
     set status = 'Presale', serviced_at = now(), serviced_by = coalesce(serviced_by, v_staff)
   where id = p_job_id
     and needs_presale
     and coalesce(status, '') not in ('Presale', 'Ready', 'Invoiced', 'Paid')
  returning * into v_job;

  if not found then
    select * into v_job from job_cards where id = p_job_id;
    if v_job.id is null then raise exception 'No such job.'; end if;
    if not v_job.needs_presale then raise exception 'This job isn''t ticked for Presale. Send it to Craig instead.'; end if;
    raise exception 'This job is already %, so it can''t go to Presale.', v_job.status;
  end if;
  return v_job;
end;
$$;

-- Peni: Presale is done, pass it to Craig.
create or replace function public.presale_done(p_job_id uuid)
returns public.job_cards language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid;
  v_job   job_cards;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  select id into v_staff from staff
   where coalesce(active, true)
     and (user_id = auth.uid() or (user_id is null and lower(email) = lower(auth.email())))
   limit 1;

  update job_cards
     set status = 'Ready', presale_at = now(), presale_by = v_staff, ready_at = now(), ready_by = v_staff
   where id = p_job_id and status = 'Presale'
  returning * into v_job;

  if not found then raise exception 'That job isn''t in Presale. Refresh and check where it is.'; end if;
  return v_job;
end;
$$;

-- Send to Craig, as before, with two additions: a Presale job can't skip
-- Presale, and the service is stamped done (for the "don't service again"
-- banner) if nothing stamped it already.
create or replace function public.mark_job_ready(p_job_id uuid)
returns public.job_cards language plpgsql security definer set search_path = public as $$
declare
  v_staff uuid;
  v_job   job_cards;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  if p_job_id is null then raise exception 'No job specified'; end if;

  -- Who is sending it — resolved on the server, the same way is_approved_staff()
  -- identifies a person, so the browser can't claim to be someone else.
  select id into v_staff from staff
   where coalesce(active, true)
     and (user_id = auth.uid() or (user_id is null and lower(email) = lower(auth.email())))
   limit 1;

  if exists (select 1 from job_cards where id = p_job_id and needs_presale and presale_at is null) then
    raise exception 'This job goes to Presale first. Press "Service done, pass to Presale", or untick Presale.';
  end if;

  update job_cards
     set status = 'Ready', ready_at = now(), ready_by = v_staff, serviced_at = coalesce(serviced_at, now())
   where id = p_job_id
     and coalesce(status, '') not in ('Invoiced', 'Paid')
  returning * into v_job;

  if not found then
    raise exception 'That job is already invoiced — nothing to send.';
  end if;

  return v_job;
end;
$$;

-- "Not finished? Reopen job": back one step.
--   Ready, after Presale  -> Presale (Peni has it again)
--   Ready, no Presale     -> In progress
--   Presale               -> In progress (the service wasn't finished)
-- Only from Ready or Presale; once Craig has invoiced, undoing it is
-- "Discard" on the invoice.
create or replace function public.reopen_job(p_job_id uuid)
returns public.job_cards language plpgsql security definer set search_path = public as $$
declare v_job job_cards;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;

  update job_cards
     set status      = case when status = 'Ready' and needs_presale and presale_at is not null then 'Presale' else 'In progress' end,
         serviced_at = case when status = 'Ready' and needs_presale and presale_at is not null then serviced_at else null end,
         presale_at  = null,
         presale_by  = null,
         ready_at    = null,
         ready_by    = null
   where id = p_job_id and status in ('Ready', 'Presale')
  returning * into v_job;

  if not found then raise exception 'Couldn''t reopen it. It may have just been invoiced. Refresh and check.'; end if;
  return v_job;
end;
$$;

revoke execute on function public.presale_default_for_job() from public, anon, authenticated;
revoke execute on function public.pass_to_presale(uuid) from public, anon;
revoke execute on function public.presale_done(uuid)    from public, anon;
revoke execute on function public.reopen_job(uuid)      from public, anon;
grant  execute on function public.pass_to_presale(uuid) to authenticated;
grant  execute on function public.presale_done(uuid)    to authenticated;
grant  execute on function public.reopen_job(uuid)      to authenticated;

-- Resale bikes go through Presale by default.
update public.customers set presale_default = true where name = 'Sales Prep Betterservice';

-- The resale bikes still in the workshop today: #132, #134, #135, #136.
-- #133 is already with Craig and stays there.
update public.job_cards set needs_presale = true
 where job_number in (132, 134, 135, 136)
   and coalesce(status, '') not in ('Ready', 'Invoiced', 'Paid');
