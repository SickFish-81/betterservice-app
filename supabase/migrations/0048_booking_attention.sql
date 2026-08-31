-- ============================================================================
-- Betterservice ATV — booking requests in the "needs attention" banner (31 Aug 2026)
--
-- A booking that sits unseen until Monday is worse than no booking form at all,
-- so new requests join the chips at the top of every back-office screen,
-- alongside unpaid invoices and bills to pay.
--
-- attention_summary() gains a column, which means dropping and recreating it —
-- a return type can't be changed in place. The new column goes LAST so nothing
-- reading the existing ones shifts.
--
-- Idempotent: safe to re-run.
-- ============================================================================

drop function if exists public.attention_summary();

create function public.attention_summary()
returns table(
  parts_requests  integer,
  low_stock       integer,
  service_due     integer,
  bills_count     integer,
  bills_total     numeric,
  invoices_unpaid integer,
  bookings_new    integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_approved_staff() then return; end if;   -- no rows for non-staff
  return query select
    (select count(*) from part_requests where status = 'Requested')::int,
    (select count(*) from parts where coalesce(min_stock,0) > 0 and qty_on_hand <= min_stock)::int,
    (select count(*) from machines m join customers c on c.id = m.customer_id
       where m.last_service_date is not null and coalesce(c.no_reminders, false) = false
         and age(now(), m.last_service_date) >= interval '12 months'
         and age(now(), m.last_service_date) <= interval '18 months')::int,
    (select count(*) from expenses where status = 'Unpaid' and paid_on_account)::int,
    (select coalesce(sum(total), 0) from expenses where status = 'Unpaid' and paid_on_account)::numeric,
    (select count(*) from invoices where sent = true and coalesce(status, '') <> 'Paid')::int,
    (select count(*) from booking_requests where status = 'new')::int;
end
$function$;

revoke execute on function public.attention_summary() from public, anon;
grant  execute on function public.attention_summary() to authenticated;
