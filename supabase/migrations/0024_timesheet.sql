-- ============================================================================
-- Betterservice Te Puke — timesheet rollup (18 July 2026)
-- Owner-only view of hours worked per person, built on the per-job time entries
-- (job_time_entries). Returns one row per entry within the period, using NZ
-- calendar dates, with the staff name and job number for aggregation on screen.
-- ============================================================================

create or replace function public.timesheet(p_from date, p_to date)
returns table(
  staff_id uuid, staff_name text, work_date date,
  job_card_id uuid, job_number text, hours numeric,
  billed boolean, note text, running boolean
)
language sql
security definer
set search_path to 'public'
as $function$
  select e.staff_id,
         coalesce(s.name, 'Unknown') as staff_name,
         (coalesce(e.started_at, e.created_at) at time zone 'Pacific/Auckland')::date as work_date,
         e.job_card_id,
         j.job_number::text as job_number,
         coalesce(e.hours, 0) as hours,
         coalesce(e.billed, false) as billed,
         e.note,
         (e.started_at is not null and e.ended_at is null) as running
  from job_time_entries e
  left join staff s on s.id = e.staff_id
  left join job_cards j on j.id = e.job_card_id
  where is_owner()
    and (coalesce(e.started_at, e.created_at) at time zone 'Pacific/Auckland')::date between p_from and p_to
  order by work_date desc, staff_name, e.created_at;
$function$;
