-- ============================================================================
-- Betterservice ATV — make the parts guards agree with the draft-invoice model
-- (7 Oct 2026)
--
-- 0073 changed what "locked" means: finalised_at IS NULL is a draft (editable),
-- IS NOT NULL is issued (frozen). The trigger it installed,
-- enforce_job_line_items_not_invoiced, got that right.
--
-- Two functions kept the pre-0073 rule and were missed: they refuse if ANY
-- invoice row exists, draft or issued. So on a job with a draft invoice the job
-- card offers "add ordered part" and "accept PO line" — the UI gates on
-- `issued = !!invoice?.finalised_at` — and the RPC then throws a lock message
-- that isn't true. That is exactly the inconsistency the draft feature existed
-- to remove.
--
-- This only ever LOOSENS: an issued invoice still locks, both here and at the
-- trigger, which remains the real backstop. Nothing that works today stops
-- working.
--
-- Bodies are otherwise byte-for-byte what was live, including the stock
-- decrement in accept_po_item_to_job and both functions' security definer /
-- search_path settings. Grants are untouched (create or replace preserves the
-- existing ACL: authenticated and service_role only, never anon).
--
-- Applied to production 7 Oct 2026 before this file was written, because the
-- bug was found while applying 0074. Idempotent: safe to re-run.
-- ============================================================================

-- add_ordered_part_to_job: was
--   if exists (select 1 from invoices where job_card_id = p_job_id)
create or replace function public.add_ordered_part_to_job(
  p_job_id       uuid,
  p_description  text,
  p_qty          numeric,
  p_cost         numeric,
  p_supplier_id  uuid default null,
  p_supplier_ref text default null,
  p_sell_price   numeric default null
)
returns public.job_line_items
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
  if p_sell_price is not null and p_sell_price < 0 then raise exception 'Sell price can''t be negative.'; end if;
  if exists (select 1 from invoices
              where job_card_id = p_job_id and finalised_at is not null) then
    raise exception 'That invoice has been issued — labour & parts are locked.';
  end if;

  if p_sell_price is not null then
    v_price := round(p_sell_price, 2);
  else
    select coalesce(parts_markup_percent, 30) into v_markup from shop_settings limit 1;
    v_markup := coalesce(v_markup, 30);
    v_price  := round(p_cost * (1 + v_markup / 100.0), 2);
  end if;

  insert into job_line_items (job_card_id, kind, description, quantity, unit_price, cost_price, supplier_id, supplier_ref)
    values (p_job_id, 'part', left(btrim(p_description), 200), p_qty, v_price, round(p_cost, 2),
            p_supplier_id, nullif(left(btrim(p_supplier_ref), 100), ''))
    returning * into v_row;

  return v_row;
end;
$fn$;

-- accept_po_item_to_job: was
--   if exists (select 1 from invoices where job_card_id = v_job)
create or replace function public.accept_po_item_to_job(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_job uuid; v_part uuid; v_qty numeric; v_accepted timestamptz; v_po_status text;
  v_name text; v_price numeric; v_cur numeric; v_line uuid;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  select i.job_card_id, i.part_id, i.qty_received, i.accepted_at, po.status
    into v_job, v_part, v_qty, v_accepted, v_po_status
    from purchase_order_items i join purchase_orders po on po.id = i.po_id where i.id = p_item_id;
  if v_job is null then raise exception 'This order line is not linked to a job'; end if;
  if v_accepted is not null then raise exception 'Already accepted onto the job'; end if;
  if v_po_status <> 'Received' then raise exception 'The order has not been received yet'; end if;
  if coalesce(v_qty, 0) <= 0 then raise exception 'Nothing was received on this line'; end if;
  if exists (select 1 from invoices
              where job_card_id = v_job and finalised_at is not null) then
    raise exception 'That invoice has been issued - parts are locked.'; end if;
  select name, unit_price into v_name, v_price from parts where id = v_part;
  insert into job_line_items (job_card_id, kind, part_id, description, quantity, unit_price)
    values (v_job, 'part', v_part, coalesce(v_name, 'Part'), v_qty, coalesce(v_price, 0)) returning id into v_line;
  select qty_on_hand into v_cur from parts where id = v_part for update;
  update parts set qty_on_hand = coalesce(v_cur, 0) - v_qty where id = v_part;
  update purchase_order_items set accepted_at = now() where id = p_item_id;
  return v_line;
end
$fn$;
