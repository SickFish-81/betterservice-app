-- ============================================================================
-- Betterservice Tepuke — inventory: suppliers + stock adjustments (Phase 3a)
-- Built 14 July 2026. Runs after 0001 (parts, staff).
-- Adds a supplier list, links parts to a supplier, and an append-only stock
-- adjustment history (stocktakes, damage, found, corrections) with an atomic
-- record_stock_adjustment() that updates on-hand and logs the change together.
-- Operational only — inventory is not posted to the ledger (parts are expensed
-- when purchased via the Expenses screen).
-- ============================================================================

create table if not exists public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  contact_name text,
  phone        text,
  email        text,
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

alter table public.parts add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create table if not exists public.stock_adjustments (
  id         uuid primary key default gen_random_uuid(),
  part_id    uuid not null references public.parts(id) on delete cascade,
  delta      integer not null,
  new_qty    integer not null,
  reason     text not null default 'Stocktake',
  note       text,
  created_by uuid references public.staff(id),
  created_at timestamptz default now()
);
create index if not exists stock_adjustments_part_idx on public.stock_adjustments (part_id, created_at desc);

-- Atomic: record an adjustment and set the new on-hand qty together.
create or replace function public.record_stock_adjustment(p_part_id uuid, p_new_qty integer, p_reason text, p_note text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_old integer; v_delta integer;
begin
  if not is_approved_staff() then raise exception 'Not authorised'; end if;
  select qty_on_hand into v_old from parts where id = p_part_id for update;
  if v_old is null then raise exception 'Part not found'; end if;
  v_delta := p_new_qty - v_old;
  if v_delta = 0 then return v_old; end if;
  insert into stock_adjustments(part_id, delta, new_qty, reason, note, created_by)
    values (p_part_id, v_delta, p_new_qty, coalesce(nullif(p_reason,''), 'Stocktake'), nullif(p_note,''),
            (select id from staff where lower(email) = lower(auth.email()) limit 1));
  update parts set qty_on_hand = p_new_qty where id = p_part_id;
  return p_new_qty;
end
$function$;
grant execute on function public.record_stock_adjustment(uuid, integer, text, text) to authenticated;

alter table public.suppliers         enable row level security;
alter table public.stock_adjustments enable row level security;

drop policy if exists suppliers_staff_all on public.suppliers;
create policy suppliers_staff_all on public.suppliers for all to authenticated using (is_approved_staff()) with check (is_approved_staff());

drop policy if exists stock_adj_select on public.stock_adjustments;
create policy stock_adj_select on public.stock_adjustments for select to authenticated using (is_approved_staff());
drop policy if exists stock_adj_insert on public.stock_adjustments;
create policy stock_adj_insert on public.stock_adjustments for insert to authenticated with check (is_approved_staff());
drop policy if exists stock_adj_delete on public.stock_adjustments;
create policy stock_adj_delete on public.stock_adjustments for delete to authenticated using (is_owner());
