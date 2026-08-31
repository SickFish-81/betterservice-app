-- ============================================================================
-- Betterservice ATV — confirm before the timer's labour goes on the job (31 Aug 2026)
--
-- Rounding up means a timer knocked on by accident bills a quarter of an hour.
-- So stopping now asks first, and the answer is passed through here: p_bill
-- true adds the labour, false stops the timer and charges nothing.
--
-- A declined stop still records the time — it stays on the timesheet, marked as
-- dealt with so it doesn't nag from the unbilled-time warning. If it was a
-- complete accident the entry can be removed from the job card as before.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.stop_job_timer(p_entry_id uuid, p_bill boolean default true)
returns public.job_time_entries
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t          job_time_entries;
  v_hours    numeric;
  v_rate     numeric;
  v_who      text;
  v_invoiced boolean;
  v_bill     boolean := coalesce(p_bill, true);
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;

  select * into t from job_time_entries where id = p_entry_id;
  if not found then raise exception 'No such time entry'; end if;
  if t.started_at is null then raise exception 'That entry was entered by hand, not timed.'; end if;
  if t.ended_at is not null then raise exception 'That timer has already been stopped.'; end if;

  -- Up to the next quarter hour, never less than one quarter.
  v_hours := ceil((extract(epoch from (now() - t.started_at)) / 3600.0) * 4) / 4.0;
  if v_hours < 0.25 then v_hours := 0.25; end if;

  select exists (select 1 from invoices where job_card_id = t.job_card_id) into v_invoiced;
  if v_invoiced then v_bill := false; end if;   -- an invoiced job is locked

  select coalesce(labour_rate, 115) into v_rate from shop_settings limit 1;
  v_rate := coalesce(v_rate, 115);
  select name into v_who from staff where id = t.staff_id;

  update job_time_entries
     set ended_at = now(),
         hours    = v_hours,
         -- Billed, or deliberately declined: either way it's dealt with. Only an
         -- invoiced job leaves it outstanding, so the warning still catches it.
         billed   = not v_invoiced
   where id = p_entry_id
  returning * into t;

  if v_bill then
    insert into job_line_items (job_card_id, kind, description, quantity, unit_price)
      values (t.job_card_id, 'labour',
              coalesce(nullif(btrim(t.note), ''), coalesce(v_who, 'Labour') || ' — labour'),
              v_hours, round(v_rate, 2));
  end if;

  return t;
end;
$$;

-- The single-argument version from 0055 is superseded.
drop function if exists public.stop_job_timer(uuid);

revoke execute on function public.stop_job_timer(uuid, boolean) from public, anon;
grant  execute on function public.stop_job_timer(uuid, boolean) to authenticated;
