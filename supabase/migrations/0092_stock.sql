-- Stock: the machines the business owns, from hire to sale.
--
-- Ben, 20 Nov 2026: Craig hires machines out (to pollinators and the like who
-- only need them seasonally), takes them back in, services them and puts them
-- up for sale. He has been keeping that on a spreadsheet ("For sale list").
-- This is that spreadsheet in the app: one row per machine, with the stage it
-- is at.
--
--   On hire -> To pick up -> Workshop -> Presale -> For sale -> Sold
--                                     (or Parts / wreck)
--
-- Who can change what (Ben: "everyone can update", with money as the line):
--   * every approved staff member can read, add and update stock rows;
--   * only an owner can set or change a PRICE, or link a row to a public
--     website listing (both are things a customer sees);
--   * nobody deletes a row through the API: a machine leaves stock by being
--     Sold, so its jobs and history stay attached.
--
-- The website listing (secondhand_listings) and the stock row share ONE price:
-- changing it on either side updates the other, and Sold on either side
-- marks the other Sold.
--
-- No bare DROP statements: the Supabase tool hangs on them.

create table if not exists public.stock_items (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines(id),
  stage            text not null default 'Workshop'
                   check (stage in ('On hire', 'To pick up', 'Workshop', 'Presale', 'For sale', 'Sold', 'Parts / wreck')),
  came_in          date,
  ready            boolean not null default false,
  work_done        text,
  to_do            text,
  asking_price     numeric(10, 2) check (asking_price is null or asking_price >= 0),
  hire_customer_id uuid references public.customers(id),
  listing_id       uuid references public.secondhand_listings(id) on delete set null,
  sold_at          date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint stock_items_one_row_per_machine unique (machine_id)
);

comment on table  public.stock_items is 'Machines the business owns (hire fleet and sale stock), one row each.';
comment on column public.stock_items.came_in is 'When it came back in (from hire, or bought in). Craig''s "Date" column.';
comment on column public.stock_items.ready is 'Craig''s "Ready" tick: ready to sell.';
comment on column public.stock_items.asking_price is 'Incl GST. Owner-only. Shared with the website listing.';

alter table public.stock_items enable row level security;

create policy stock_staff_select on public.stock_items for select using (is_approved_staff());
create policy stock_staff_insert on public.stock_items for insert with check (is_approved_staff());
create policy stock_staff_update on public.stock_items for update using (is_approved_staff()) with check (is_approved_staff());
-- (no delete policy: rows are never deleted through the API)

-- Owner-only fields, and the updated_at stamp.
-- SECURITY INVOKER on purpose: current_user must be the caller (authenticated
-- for anyone using the app), not the function's owner. The sync triggers
-- below run as definer, so a price copied over from the website listing gets
-- through, which is intended.
create or replace function public.stock_items_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_system boolean := current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if not v_system and not is_owner() then
    if (tg_op = 'INSERT' and new.asking_price is not null)
       or (tg_op = 'UPDATE' and new.asking_price is distinct from old.asking_price) then
      raise exception 'Only Craig or Ben can set a price.';
    end if;
    if (tg_op = 'INSERT' and new.listing_id is not null)
       or (tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id) then
      raise exception 'Only Craig or Ben can put a machine on the website.';
    end if;
  end if;
  if new.stage = 'Sold' and new.sold_at is null then new.sold_at := (now() at time zone 'Pacific/Auckland')::date; end if;
  if new.stage <> 'Sold' then new.sold_at := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger trg_stock_items_guard
  before insert or update on public.stock_items
  for each row execute function public.stock_items_guard();

-- Stock row -> website listing: same price, and Sold means sold.
create or replace function public.stock_items_sync_listing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.listing_id is null then return new; end if;
  update secondhand_listings l
     set price  = coalesce(new.asking_price, l.price),
         status = case when new.stage = 'Sold' then 'Sold'
                       when l.status = 'Sold' and new.stage = 'For sale' then 'Available'
                       else l.status end
   where l.id = new.listing_id
     and (l.price is distinct from coalesce(new.asking_price, l.price)
          or (new.stage = 'Sold' and l.status <> 'Sold')
          or (new.stage = 'For sale' and l.status = 'Sold'));
  return new;
end;
$$;
create or replace trigger trg_stock_items_sync_listing
  after insert or update of asking_price, stage, listing_id on public.stock_items
  for each row execute function public.stock_items_sync_listing();

-- Website listing -> stock row: a price or Sold set on the For Sale page
-- shows on the Stock page too.
create or replace function public.secondhand_listing_sync_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update stock_items s
     set asking_price = case when new.price is distinct from old.price then new.price else s.asking_price end,
         stage        = case when new.status = 'Sold' and old.status <> 'Sold' then 'Sold' else s.stage end
   where s.listing_id = new.id
     and ((new.price is distinct from old.price and s.asking_price is distinct from new.price)
          or (new.status = 'Sold' and old.status <> 'Sold' and s.stage <> 'Sold'));
  return new;
end;
$$;
create or replace trigger trg_secondhand_listing_sync_stock
  after update of price, status on public.secondhand_listings
  for each row execute function public.secondhand_listing_sync_stock();

revoke execute on function public.stock_items_guard()             from public, anon, authenticated;
revoke execute on function public.stock_items_sync_listing()      from public, anon, authenticated;
revoke execute on function public.secondhand_listing_sync_stock() from public, anon, authenticated;
