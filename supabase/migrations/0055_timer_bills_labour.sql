-- ============================================================================
-- Betterservice ATV — stopping the timer bills the labour (31 Aug 2026)
--
-- Before this, clocked time and billed labour were two separate acts and the
-- second one was easy to forget — which is how job 10 was invoiced with 2.38
-- hours on it and no labour at all.
--
-- Now stopping the timer does both: the entry is closed, the time is rounded UP
-- to the next quarter hour, and a labour line goes straight onto the job at the
-- shop's hourly rate.
--
-- The rate moves out of the code and into Settings at the same time — it was
-- hard-coded as 115 in two different places, which is one place too many for a
-- number that decides what customers pay.
--
-- Rounding is deliberately UP: 61 minutes bills as 1.25 h, not 1.0. That's the
-- shop's stated rule. A minimum of a quarter hour applies, so a timer started
-- and stopped by accident still bills 15 minutes — worth knowing, because it
-- means an accidental start is not free.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.shop_settings
  add column if not exists labour_rate numeric not null default 115;

alter table public.shop_settings drop constraint if exists shop_settings_labour_rate_sane;
alter table public.shop_settings add constraint shop_settings_labour_rate_sane
  check (labour_rate >= 0 and labour_rate <= 10000);

create or replace function public.stop_job_timer(p_entry_id uuid)
returns public.job_time_entries
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t         job_time_entries;
  v_hours   numeric;
  v_rate    numeric;
  v_who     text;
  v_invoiced boolean;
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
  select coalesce(labour_rate, 115) into v_rate from shop_settings limit 1;
  v_rate := coalesce(v_rate, 115);
  select name into v_who from staff where id = t.staff_id;

  -- An invoiced job is locked, so the time is still recorded but left unbilled;
  -- it shows up in the unbilled-time warning rather than silently vanishing.
  update job_time_entries
     set ended_at = now(), hours = v_hours, billed = not v_invoiced
   where id = p_entry_id
  returning * into t;

  if not v_invoiced then
    insert into job_line_items (job_card_id, kind, description, quantity, unit_price)
      values (t.job_card_id, 'labour',
              coalesce(nullif(btrim(t.note), ''), coalesce(v_who, 'Labour') || ' — labour'),
              v_hours, round(v_rate, 2));
  end if;

  return t;
end;
$$;

revoke execute on function public.stop_job_timer(uuid) from public, anon;
grant  execute on function public.stop_job_timer(uuid) to authenticated;
