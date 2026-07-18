-- ============================================================================
-- Betterservice Te Puke — partial / multiple purchase-order receipts (18 July 2026)
-- Phase 3b follow-up. Receive an order across several deliveries: quantities
-- accumulate on each line, every delivery books its own on-account bill, and the
-- PO sits at 'Partially received' until every ordered line is fully in.
-- ============================================================================

-- 1) allow a 'Partially received' status
alter table public.purchase_orders drop constraint if exists purchase_orders_status_check;
alter table public.purchase_orders add constraint purchase_orders_status_check
  check (status = any (array['Draft','Ordered','Partially received','Received','Cancelled']));

-- 2) link each delivery's bill back to its PO. Plain column (not a FK) on purpose:
--    a second FK between expenses and purchase_orders would make the existing
--    purchase_orders -> expenses embed ambiguous in PostgREST.
alter table public.expenses add column if not exists purchase_order_id uuid;
create index if not exists idx_expenses_purchase_order on public.expenses(purchase_order_id);
update public.expenses e set purchase_order_id = po.id
  from public.purchase_orders po
  where po.expense_id = e.id and e.purchase_order_id is null;

-- 3) additive, multi-delivery receive
create or replace function public.receive_purchase_order(p_po_id uuid, p_lines jsonb, p_gst numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text; v_sup text; v_acct uuid; v_no text; v_staff uuid;
  v_goods numeric := 0; v_gst numeric; v_exp uuid;
  l jsonb; v_qty numeric; v_cost numeric; v_part uuid; v_cur numeric;
  v_complete boolean;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  select status into v_status from purchase_orders where id = p_po_id;
  if v_status is null then raise exception 'Purchase order not found'; end if;
  if v_status = 'Received' then raise exception 'This order has already been fully received'; end if;
  if v_status = 'Cancelled' then raise exception 'This order was cancelled'; end if;

  select s.name, lpad(po.po_number::text, 5, '0') into v_sup, v_no
    from purchase_orders po left join suppliers s on s.id = po.supplier_id where po.id = p_po_id;
  select id into v_acct from accounts where code = '500';
  if v_acct is null then raise exception 'Cost of Parts account (500) missing'; end if;
  select id into v_staff from staff where lower(email) = lower(auth.email()) limit 1;

  -- each line's qty_received is the amount arriving in THIS delivery (added to any prior)
  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty  := round(coalesce((l->>'qty_received')::numeric, 0), 2);
    v_cost := coalesce((l->>'unit_cost')::numeric, 0);
    if v_qty > 0 then
      update purchase_order_items
        set qty_received = round(coalesce(qty_received,0) + v_qty, 2), unit_cost = v_cost
        where id = (l->>'item_id')::uuid and po_id = p_po_id
        returning part_id into v_part;
      if v_part is not null then
        select qty_on_hand into v_cur from parts where id = v_part for update;
        insert into stock_adjustments(part_id, delta, new_qty, reason, note, created_by)
          values (v_part, v_qty, coalesce(v_cur,0) + v_qty, 'Received', 'PO #' || v_no, v_staff);
        update parts set qty_on_hand = coalesce(v_cur,0) + v_qty where id = v_part;
      end if;
      v_goods := v_goods + (v_qty * v_cost);
    end if;
  end loop;

  v_goods := round(v_goods, 2);
  if v_goods > 0 then
    v_gst := round(coalesce(p_gst, v_goods * 0.15), 2);
    insert into expenses(expense_date, supplier, description, account_id, amount_ex_gst, gst,
                         gst_claimable, paid_on_account, method, status, purchase_order_id)
      values ((now() at time zone 'Pacific/Auckland')::date, v_sup, 'Purchase order #' || v_no,
              v_acct, v_goods, v_gst, true, true, 'account', 'Unpaid', p_po_id)
      returning id into v_exp;
  end if;

  -- fully received once every line has at least its ordered quantity in
  select bool_and(coalesce(qty_received,0) >= qty_ordered) into v_complete
    from purchase_order_items where po_id = p_po_id;

  if coalesce(v_complete, true) then
    update purchase_orders
      set status = 'Received', received_date = (now() at time zone 'Pacific/Auckland')::date,
          expense_id = coalesce(v_exp, expense_id)
      where id = p_po_id;
  else
    update purchase_orders
      set status = 'Partially received', expense_id = coalesce(v_exp, expense_id)
      where id = p_po_id;
  end if;

  return v_exp;
end $function$;
