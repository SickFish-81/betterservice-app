-- ============================================================================
-- Betterservice Te Puke — parts requests (Phase 3g)
-- Built 16 July 2026. The team flags a part needed for a job from the job card;
-- it lands in Craig's in-app Parts Requests queue (dashboard tile + count).
-- Known & common parts (a set supplier, ordered 2+ times before) get a one-click
-- "Create purchase order" that drafts a PO to that supplier, tagged to the job,
-- so on receive it flows back onto the job card to Accept. In-app only.
-- ============================================================================

create table if not exists public.part_requests (
  id           uuid primary key default gen_random_uuid(),
  job_card_id  uuid not null references public.job_cards(id) on delete cascade,
  part_id      uuid references public.parts(id) on delete set null,
  description  text not null,
  quantity     integer not null default 1,
  note         text,
  status       text not null default 'Requested',   -- Requested | Ordered | Done | Cancelled
  requested_by uuid references public.staff(id) on delete set null,
  po_id        uuid references public.purchase_orders(id) on delete set null,
  created_at   timestamptz not null default now()
);

alter table public.part_requests enable row level security;
create policy staff_all on public.part_requests for all using (is_approved_staff()) with check (is_approved_staff());
create index if not exists part_requests_job_idx on public.part_requests(job_card_id);
create index if not exists part_requests_status_idx on public.part_requests(status);

create or replace function public.create_po_from_request(p_request_id uuid, p_qty integer default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_part uuid; v_job uuid; v_sup uuid; v_qty integer; v_status text; v_cost numeric; v_name text; v_po uuid;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;

  select part_id, job_card_id, quantity, status into v_part, v_job, v_qty, v_status
    from part_requests where id = p_request_id;
  if v_part is null then raise exception 'This request has no linked inventory part - order it manually.'; end if;
  if v_status <> 'Requested' then raise exception 'This request is not open.'; end if;

  select supplier_id, name into v_sup, v_name from parts where id = v_part;
  if v_sup is null then raise exception 'That part has no supplier set - add one on the Parts page.'; end if;

  v_qty := greatest(coalesce(p_qty, v_qty, 1), 1);
  select unit_cost into v_cost from purchase_order_items
    where part_id = v_part and coalesce(unit_cost, 0) > 0 order by created_at desc limit 1;

  insert into purchase_orders(supplier_id, status) values (v_sup, 'Draft') returning id into v_po;
  insert into purchase_order_items(po_id, part_id, description, qty_ordered, unit_cost, job_card_id)
    values (v_po, v_part, coalesce(v_name, 'Part'), v_qty, coalesce(v_cost, 0), v_job);
  update part_requests set status = 'Ordered', po_id = v_po where id = p_request_id;
  return v_po;
end
$$;

grant execute on function public.create_po_from_request(uuid, integer) to authenticated;
