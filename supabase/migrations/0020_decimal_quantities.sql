-- ============================================================================
-- Betterservice Te Puke — inventory quantities to 2 decimal places (Phase 3i)
-- Built 16 July 2026. The team uses part-quantities like 2.75 L of oil, so all
-- inventory quantity columns move from integer to numeric(12,2), and every RPC
-- that reads/writes quantity is updated to round to 2dp. job_line_items.quantity
-- was already numeric(10,2). counter_sale_items.amount is generated from
-- quantity, so it's dropped and re-added around the type change.
-- ============================================================================

alter table public.counter_sale_items drop column amount;
alter table public.counter_sale_items alter column quantity type numeric(12,2) using quantity::numeric(12,2);
alter table public.counter_sale_items add column amount numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored;

alter table public.parts                alter column qty_on_hand type numeric(12,2) using qty_on_hand::numeric(12,2);
alter table public.parts                alter column min_stock   type numeric(12,2) using min_stock::numeric(12,2);
alter table public.purchase_order_items alter column qty_ordered  type numeric(12,2) using qty_ordered::numeric(12,2);
alter table public.purchase_order_items alter column qty_received type numeric(12,2) using qty_received::numeric(12,2);
alter table public.stock_adjustments    alter column delta   type numeric(12,2) using delta::numeric(12,2);
alter table public.stock_adjustments    alter column new_qty type numeric(12,2) using new_qty::numeric(12,2);
alter table public.part_requests        alter column quantity type numeric(12,2) using quantity::numeric(12,2);

-- ---- RPCs updated for numeric quantities ----

drop function if exists public.record_stock_adjustment(uuid, integer, text, text);
create function public.record_stock_adjustment(p_part_id uuid, p_new_qty numeric, p_reason text, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_old numeric; v_delta numeric; v_new numeric;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  v_new := round(coalesce(p_new_qty, 0), 2);
  select qty_on_hand into v_old from parts where id = p_part_id for update;
  if v_old is null then raise exception 'Part not found'; end if;
  v_delta := v_new - v_old;
  if v_delta = 0 then return v_old; end if;
  insert into stock_adjustments(part_id, delta, new_qty, reason, note, created_by)
    values (p_part_id, v_delta, v_new, coalesce(nullif(p_reason,''), 'Stocktake'), nullif(p_note,''),
            (select id from staff where lower(email) = lower(auth.email()) limit 1));
  update parts set qty_on_hand = v_new where id = p_part_id;
  return v_new;
end $$;
grant execute on function public.record_stock_adjustment(uuid, numeric, text, text) to authenticated;

drop function if exists public.create_po_from_request(uuid, integer);
create function public.create_po_from_request(p_request_id uuid, p_qty numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_part uuid; v_job uuid; v_sup uuid; v_qty numeric; v_status text; v_cost numeric; v_name text; v_po uuid;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  select part_id, job_card_id, quantity, status into v_part, v_job, v_qty, v_status from part_requests where id = p_request_id;
  if v_part is null then raise exception 'This request has no linked inventory part - order it manually.'; end if;
  if v_status <> 'Requested' then raise exception 'This request is not open.'; end if;
  select supplier_id, name into v_sup, v_name from parts where id = v_part;
  if v_sup is null then raise exception 'That part has no supplier set - add one on the Parts page.'; end if;
  v_qty := greatest(round(coalesce(p_qty, v_qty, 1), 2), 0.01);
  select unit_cost into v_cost from purchase_order_items where part_id = v_part and coalesce(unit_cost, 0) > 0 order by created_at desc limit 1;
  insert into purchase_orders(supplier_id, status) values (v_sup, 'Draft') returning id into v_po;
  insert into purchase_order_items(po_id, part_id, description, qty_ordered, unit_cost, job_card_id)
    values (v_po, v_part, coalesce(v_name, 'Part'), v_qty, coalesce(v_cost, 0), v_job);
  update part_requests set status = 'Ordered', po_id = v_po where id = p_request_id;
  return v_po;
end $$;
grant execute on function public.create_po_from_request(uuid, numeric) to authenticated;

create or replace function public.receive_purchase_order(p_po_id uuid, p_lines jsonb, p_gst numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_sup text; v_acct uuid; v_no text; v_staff uuid;
  v_goods numeric := 0; v_gst numeric; v_exp uuid;
  l jsonb; v_qty numeric; v_cost numeric; v_part uuid; v_cur numeric;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  select status into v_status from purchase_orders where id = p_po_id;
  if v_status is null then raise exception 'Purchase order not found'; end if;
  if v_status = 'Received' then raise exception 'This order has already been received'; end if;
  select s.name, lpad(po.po_number::text, 5, '0') into v_sup, v_no
    from purchase_orders po left join suppliers s on s.id = po.supplier_id where po.id = p_po_id;
  select id into v_acct from accounts where code = '500';
  if v_acct is null then raise exception 'Cost of Parts account (500) missing'; end if;
  select id into v_staff from staff where lower(email) = lower(auth.email()) limit 1;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty  := round(coalesce((l->>'qty_received')::numeric, 0), 2);
    v_cost := coalesce((l->>'unit_cost')::numeric, 0);
    update purchase_order_items set qty_received = v_qty, unit_cost = v_cost
      where id = (l->>'item_id')::uuid and po_id = p_po_id returning part_id into v_part;
    if v_qty > 0 and v_part is not null then
      select qty_on_hand into v_cur from parts where id = v_part for update;
      insert into stock_adjustments(part_id, delta, new_qty, reason, note, created_by)
        values (v_part, v_qty, coalesce(v_cur,0) + v_qty, 'Received', 'PO #' || v_no, v_staff);
      update parts set qty_on_hand = coalesce(v_cur,0) + v_qty where id = v_part;
    end if;
    v_goods := v_goods + (v_qty * v_cost);
  end loop;
  v_goods := round(v_goods, 2);
  v_gst := round(coalesce(p_gst, v_goods * 0.15), 2);
  if v_goods > 0 then
    insert into expenses(expense_date, supplier, description, account_id, amount_ex_gst, gst, gst_claimable, paid_on_account, method, status)
      values ((now() at time zone 'Pacific/Auckland')::date, v_sup, 'Purchase order #' || v_no, v_acct, v_goods, v_gst, true, true, 'account', 'Unpaid')
      returning id into v_exp;
  end if;
  update purchase_orders set status = 'Received', received_date = (now() at time zone 'Pacific/Auckland')::date, expense_id = v_exp where id = p_po_id;
  return v_exp;
end $$;

create or replace function public.accept_po_item_to_job(p_item_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
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
  if exists (select 1 from invoices where job_card_id = v_job) then raise exception 'This job has an invoice - parts are locked.'; end if;
  select name, unit_price into v_name, v_price from parts where id = v_part;
  insert into job_line_items (job_card_id, kind, part_id, description, quantity, unit_price)
    values (v_job, 'part', v_part, coalesce(v_name, 'Part'), v_qty, coalesce(v_price, 0)) returning id into v_line;
  select qty_on_hand into v_cur from parts where id = v_part for update;
  update parts set qty_on_hand = coalesce(v_cur, 0) - v_qty where id = v_part;
  update purchase_order_items set accepted_at = now() where id = p_item_id;
  return v_line;
end $$;

create or replace function public.create_counter_sale(p_customer_id uuid, p_items jsonb, p_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid; v_sale uuid; v_no bigint; v_staff uuid;
  v_sub numeric := 0; v_gst numeric; v_total numeric; v_lines jsonb;
  l jsonb; v_part uuid; v_qty numeric; v_price numeric; v_desc text;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'No items in the sale'; end if;
  for l in select * from jsonb_array_elements(p_items) loop
    v_qty := round(coalesce((l->>'quantity')::numeric, 0), 2);
    v_price := coalesce((l->>'unit_price')::numeric, 0);
    v_sub := v_sub + round(v_qty * v_price, 2);
  end loop;
  v_sub := round(v_sub, 2);
  if v_sub <= 0 then raise exception 'Sale total must be greater than zero'; end if;
  v_gst := round(v_sub * 0.15, 2);
  v_total := round(v_sub + v_gst, 2);
  v_cust := coalesce(p_customer_id, (select id from customers where name = 'Cash Sale' limit 1));
  select id into v_staff from staff where lower(email) = lower(auth.email()) limit 1;
  insert into counter_sales (customer_id, subtotal, gst, total, payment_method, created_by)
    values (v_cust, v_sub, v_gst, v_total, nullif(p_method, ''), v_staff) returning id, sale_number into v_sale, v_no;
  for l in select * from jsonb_array_elements(p_items) loop
    v_part := nullif(l->>'part_id', '')::uuid;
    v_qty := round(coalesce((l->>'quantity')::numeric, 0), 2);
    v_price := coalesce((l->>'unit_price')::numeric, 0);
    v_desc := coalesce(nullif(l->>'description', ''), 'Item');
    insert into counter_sale_items (sale_id, part_id, description, quantity, unit_price)
      values (v_sale, v_part, v_desc, v_qty, v_price);
    if v_part is not null then
      update parts set qty_on_hand = qty_on_hand - v_qty where id = v_part;
    end if;
  end loop;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '100', 'debit', v_total),
    jsonb_build_object('account_code', '410', 'credit', v_sub));
  if v_gst > 0 then v_lines := v_lines || jsonb_build_object('account_code', '200', 'credit', v_gst); end if;
  perform post_entry((now() at time zone 'Pacific/Auckland')::date, 'Counter sale #' || lpad(v_no::text, 5, '0'), 'counter_sale', v_sale, v_lines);
  return jsonb_build_object('sale_id', v_sale, 'sale_number', v_no, 'subtotal', v_sub, 'gst', v_gst, 'total', v_total);
end $$;
