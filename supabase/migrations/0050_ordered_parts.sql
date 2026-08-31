-- ============================================================================
-- Betterservice ATV — parts ordered in for a job (31 Aug 2026)
--
-- Replaces the parts-request queue. A mechanic no longer "requests" a part and
-- waits; the part is ordered from the supplier and put straight on the job, with
-- what it cost. The charge is worked out from that cost plus the shop's markup,
-- so nobody is doing arithmetic in their head at the counter.
--
-- The markup lives in Settings rather than in the code, because a margin is a
-- business decision that shouldn't need a deploy to change.
--
-- job_line_items.amount is a GENERATED column (quantity * unit_price), so it is
-- never inserted — only quantity and unit_price are set.
--
-- The part_requests TABLE and its rows are deliberately left alone. The screens
-- are gone, the data is not destroyed.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.shop_settings
  add column if not exists parts_markup_percent numeric not null default 30;

alter table public.shop_settings drop constraint if exists shop_settings_markup_sane;
alter table public.shop_settings add constraint shop_settings_markup_sane
  check (parts_markup_percent >= 0 and parts_markup_percent <= 500);

-- What the shop paid. Kept so the margin on a job is answerable later; it is
-- never shown to the customer.
alter table public.job_line_items
  add column if not exists cost_price numeric;

alter table public.job_line_items drop constraint if exists job_line_items_cost_sane;
alter table public.job_line_items add constraint job_line_items_cost_sane
  check (cost_price is null or cost_price >= 0);

create or replace function public.add_ordered_part_to_job(
  p_job_id      uuid,
  p_description text,
  p_qty         numeric,
  p_cost        numeric
)
returns public.job_line_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_markup numeric;
  v_price  numeric;
  v_row    job_line_items;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  if p_job_id is null then raise exception 'No job specified'; end if;
  if coalesce(btrim(p_description), '') = '' then raise exception 'Give the part a name.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero.'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'Enter what the part cost you.'; end if;
  if exists (select 1 from invoices where job_card_id = p_job_id) then
    raise exception 'This job has an invoice — labour & parts are locked.';
  end if;

  select coalesce(parts_markup_percent, 30) into v_markup from shop_settings limit 1;
  v_markup := coalesce(v_markup, 30);
  v_price  := round(p_cost * (1 + v_markup / 100.0), 2);

  insert into job_line_items (job_card_id, kind, description, quantity, unit_price, cost_price)
    values (p_job_id, 'part', left(btrim(p_description), 200), p_qty, v_price, round(p_cost, 2))
    returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_ordered_part_to_job(uuid, text, numeric, numeric) from public, anon;
grant  execute on function public.add_ordered_part_to_job(uuid, text, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Parts requests are retired, so they leave the "needs attention" banner.
-- ---------------------------------------------------------------------------
drop function if exists public.attention_summary();

create function public.attention_summary()
returns table(
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
    (select count(*) from booking_requests where status = 'new')::int;
end
$function$;

revoke execute on function public.attention_summary() from public, anon;
grant  execute on function public.attention_summary() to authenticated;
