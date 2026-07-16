-- ============================================================================
-- Betterservice Te Puke — owner "needs attention" summary (Phase 3h)
-- Built 16 July 2026. One owner-gated call powering the back-office attention
-- banner: open parts requests, parts low on stock, machines due for a service
-- (12–18 months), unpaid supplier bills (count + total owing), and unpaid
-- customer invoices. Returns no rows for non-approved logins.
-- ============================================================================

create or replace function public.attention_summary()
returns table (parts_requests int, low_stock int, service_due int, bills_count int, bills_total numeric, invoices_unpaid int)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    (select count(*) from invoices where sent = true and coalesce(status, '') <> 'Paid')::int;
end
$$;

grant execute on function public.attention_summary() to authenticated;
