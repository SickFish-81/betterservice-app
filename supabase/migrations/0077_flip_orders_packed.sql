-- FLIP orders: a "packed and ready to send" sign-off, and the access the
-- Betterservice app needs to show them.
--
-- WHY THIS EXISTS
-- The shop writes an order into flip_orders and emails Craig. That is the only
-- nudge there is, and an email is a thing you read once. Nothing in the app
-- says how many orders are sitting there unsent, because the table has no
-- fulfilment state at all — `stock_taken` and `emailed` are webhook plumbing,
-- not "has this gone out".
--
-- So: one nullable timestamp. Null means still to pack. Set means gone.
-- A count of nulls is a number that can actually reach zero, which is the
-- whole point of putting it on the dashboard.
--
-- DELIBERATELY NOT A STATUS ENUM. An order is either packed or it isn't, and
-- `packed_at is null` cannot drift out of sync with itself the way a text
-- status column does. If dispatch ever grows stages, that is a new table of
-- events, not more strings in this one.
--
-- WHAT COMES LATER
-- The sign-off button is the intended hook for the NZ Couriers integration:
-- when that lands, pressing it would create the consignment and bring back a
-- tracking number. Nothing here assumes it — there is no tracking column yet,
-- on purpose, because an empty column nobody fills is worse than no column.

alter table public.flip_orders
  add column if not exists packed_at timestamptz,
  add column if not exists packed_by uuid references public.staff(id);

comment on column public.flip_orders.packed_at is
  'When the order was signed off as packed and ready to send. Null = still to pack.';
comment on column public.flip_orders.packed_by is
  'Which staff member signed it off.';

-- The dashboard asks one question over and over: what is still to pack? A
-- partial index keeps that cheap and stays tiny, because the rows leave it
-- forever once they are packed.
create index if not exists flip_orders_to_pack_idx
  on public.flip_orders (created_at desc)
  where packed_at is null;

-- ---------------------------------------------------------------- access
--
-- flip_orders has had RLS ON WITH ZERO POLICIES since it was created, which
-- denies everyone and is why the shop reaches it through the service role.
-- That stays true for the shop. These policies open exactly two doors, both
-- for signed-in OWNERS only (Craig and Ben):
--
--   read   — to list what is still to pack
--   update — to sign one off
--
-- Owner rather than all staff is the conservative choice: the rows carry
-- customer names, addresses, phone numbers and order totals. If Anthony or
-- Bjorn ever do the packing, widen the SELECT policy to is_approved_staff()
-- and leave the UPDATE on is_owner().

drop policy if exists flip_orders_owner_read on public.flip_orders;
create policy flip_orders_owner_read
  on public.flip_orders for select
  to authenticated
  using (public.is_owner());

drop policy if exists flip_orders_owner_pack on public.flip_orders;
create policy flip_orders_owner_pack
  on public.flip_orders for update
  to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- RLS cannot restrict WHICH columns an update touches, so the column grant
-- does it instead. An owner may stamp an order packed; they may not rewrite
-- the customer's address or what they paid.
--
-- The blanket grants that shipped with the table go first. `from public, anon`
-- rather than `from anon, authenticated` on purpose — revoking from anon alone
-- leaves the default grant to PUBLIC intact and changes nothing, silently.
-- That exact mistake made migration 0076's first attempt a no-op.
revoke all on public.flip_orders from public, anon, authenticated;
revoke all on public.flip_stock  from public, anon, authenticated;

grant select                            on public.flip_orders to authenticated;
grant update (packed_at, packed_by)     on public.flip_orders to authenticated;

-- ---------------------------------------------------------------- checks
-- 0076 only caught its own failure because it asserted. Same here.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'flip_orders'
                    and column_name = 'packed_at') then
    raise exception 'packed_at was not added';
  end if;

  if has_table_privilege('anon', 'public.flip_orders', 'SELECT') then
    raise exception 'anon can still read flip_orders — customer names and addresses are exposed';
  end if;

  if has_table_privilege('anon', 'public.flip_stock', 'SELECT') then
    raise exception 'anon can still read flip_stock';
  end if;

  if has_column_privilege('authenticated', 'public.flip_orders', 'email', 'UPDATE') then
    raise exception 'authenticated can update more than the packed columns';
  end if;

  if not has_column_privilege('authenticated', 'public.flip_orders', 'packed_at', 'UPDATE') then
    raise exception 'owners cannot sign an order off';
  end if;

  -- The one that matters most. service_role is granted directly, not through
  -- PUBLIC, so the revokes above should not touch it — but "should not" is not
  -- a thing to find out from a customer whose payment went through and whose
  -- order never appeared. If this fires, the whole migration rolls back.
  if not has_table_privilege('service_role', 'public.flip_orders', 'INSERT') then
    raise exception 'the shop can no longer write orders';
  end if;
  if not has_table_privilege('service_role', 'public.flip_stock', 'SELECT') then
    raise exception 'the shop can no longer read stock';
  end if;
end $$;
