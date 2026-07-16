-- ============================================================================
-- Betterservice Te Puke — automatic service reminders (SMS)
-- Built 16 July 2026. SMS is used only for service reminders, sent automatically
-- a few a day (adjustable) so replies don't all land at once. This adds:
--   • shop_settings.reminders_per_day — daily send cap (default 5)
--   • due_for_sms_reminder(limit) — the machines to text, mirroring the /due
--     page: 12–18 months since last service, has a phone, reminders on, and not
--     already reminded since the last service. Most overdue first.
-- The send-due-reminders edge function calls this daily (via pg_cron) and texts
-- each customer, marking last_reminder_sent so no one is texted twice a cycle.
-- ============================================================================

alter table public.shop_settings add column if not exists reminders_per_day integer not null default 5;

create or replace function public.due_for_sms_reminder(p_limit integer default 5)
returns table (machine_id uuid, customer_id uuid, customer_name text, phone text, machine_label text, months integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, c.id, c.name, c.phone,
         btrim(concat_ws(' ', m.type, m.make, m.model)) as machine_label,
         (extract(year from age(now(), m.last_service_date)) * 12
          + extract(month from age(now(), m.last_service_date)))::int as months
  from machines m
  join customers c on c.id = m.customer_id
  where m.last_service_date is not null
    and coalesce(c.no_reminders, false) = false
    and coalesce(c.phone, '') <> ''
    and (m.last_reminder_sent is null or m.last_reminder_sent < m.last_service_date)
    and age(now(), m.last_service_date) >= interval '12 months'
    and age(now(), m.last_service_date) <= interval '18 months'
  order by m.last_service_date asc
  limit greatest(coalesce(p_limit, 5), 0);
$$;
