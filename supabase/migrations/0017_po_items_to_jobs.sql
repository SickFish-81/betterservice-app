-- ============================================================================
-- Betterservice Te Puke — link purchase-order lines to jobs (Phase 3f)
-- Built 16 July 2026. Parts ordered for a specific repair can be tagged to a
-- job card per PO line. Once the PO is received, those lines appear on the job
-- card as "arrived", and staff "accept" each onto the job — creating a billable
-- part line at the sell price and drawing it back out of stock (the parts went
-- INTO stock when the PO was received). accepted_at stops double-accepting.
-- Cost was expensed at receive (Cost of Parts); revenue is recognised when the
-- job is invoiced — consistent with the app's periodic-inventory model.
-- ============================================================================

alter table public.purchase_order_items add column if not exists job_card_id uuid references public.job_cards(id) on delete set null;
alter table public.purchase_order_items add column if not exists accepted_at timestamptz;

create index if not exists poi_job_idx on public.purchase_order_items(job_card_id);

create or replace function public.accept_po_item_to_job(p_item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job uuid; v_part uuid; v_qty integer; v_accepted timestamptz; v_po_status text;
  v_name text; v_price numeric; v_cur integer; v_line uuid;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;

  select i.job_card_id, i.part_id, i.qty_received, i.accepted_at, po.status
    into v_job, v_part, v_qty, v_accepted, v_po_status
    from purchase_order_items i
    join purchase_orders po on po.id = i.po_id
   where i.id = p_item_id;

  if v_job is null then raise exception 'This order line is not linked to a job'; end if;
  if v_accepted is not null then raise exception 'Already accepted onto the job'; end if;
  if v_po_status <> 'Received' then raise exception 'The order has not been received yet'; end if;
  if coalesce(v_qty, 0) <= 0 then raise exception 'Nothing was received on this line'; end if;
  if exists (select 1 from invoices where job_card_id = v_job) then
    raise exception 'This job has an invoice - parts are locked.';
  end if;

  select name, unit_price into v_name, v_price from parts where id = v_part;

  insert into job_line_items (job_card_id, kind, part_id, description, quantity, unit_price)
    values (v_job, 'part', v_part, coalesce(v_name, 'Part'), v_qty, coalesce(v_price, 0))
    returning id into v_line;

  -- parts landed in stock on receive; selling them on the job takes them back out
  select qty_on_hand into v_cur from parts where id = v_part for update;
  update parts set qty_on_hand = coalesce(v_cur, 0) - v_qty where id = v_part;

  update purchase_order_items set accepted_at = now() where id = p_item_id;
  return v_line;
end
$$;

grant execute on function public.accept_po_item_to_job(uuid) to authenticated;
