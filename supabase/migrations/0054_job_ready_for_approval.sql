-- ============================================================================
-- Betterservice ATV — hand a finished job to Craig (31 Aug 2026)
--
-- The hand-off already existed, as a convention: set the status dropdown to
-- "Ready" and hope someone notices. Nothing told the mechanic that's what the
-- dropdown was for, and nothing told Craig it had happened — so finished work
-- could sit unbilled, which is how job 10 went out with 2.38 unbilled hours.
--
-- This makes it an explicit action, stamped with who and when, and puts ready
-- jobs in the "needs attention" banner alongside bills and bookings.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.job_cards
  add column if not exists ready_at timestamptz,
  add column if not exists ready_by uuid;

create or replace function public.mark_job_ready(p_job_id uuid)
returns public.job_cards
language plpgsql
security definer
set search_path to 'public'
as $$
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

  update job_cards
     set status = 'Ready', ready_at = now(), ready_by = v_staff
   where id = p_job_id
     and coalesce(status, '') not in ('Invoiced', 'Paid')
  returning * into v_job;

  if not found then
    raise exception 'That job is already invoiced — nothing to send.';
  end if;

  return v_job;
end;
$$;

revoke execute on function public.mark_job_ready(uuid) from public, anon;
grant  execute on function public.mark_job_ready(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Ready jobs join the banner.
-- ---------------------------------------------------------------------------
drop function if exists public.attention_summary();

create function public.attention_summary()
returns table(
  low_stock       integer,
  service_due     integer,
  bills_count     integer,
  bills_total     numeric,
  invoices_unpaid integer,
  bookings_new    integer,
  jobs_ready      integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_approved_staff() then return; end if;
  return query select
    (select count(*) from parts where coalesce(min_stock,0) > 0 and qty_on_hand <= min_stock)::int,
    (select count(*) from machines m join customers c on c.id = m.customer_id
       where m.last_service_date is not null and coalesce(c.no_reminders, false) = false
         and age(now(), m.last_service_date) >= interval '12 months'
         and age(now(), m.last_service_date) <= interval '18 months')::int,
    (select count(*) from expenses where status = 'Unpaid' and paid_on_account)::int,
    (select coalesce(sum(total), 0) from expenses where status = 'Unpaid' and paid_on_account)::numeric,
    (select count(*) from invoices where sent = true and coalesce(status, '') <> 'Paid')::int,
    (select count(*) from booking_requests where status = 'new')::int,
    (select count(*) from job_cards where status = 'Ready')::int;
end
$function$;

revoke execute on function public.attention_summary() from public, anon;
grant  execute on function public.attention_summary() to authenticated;
