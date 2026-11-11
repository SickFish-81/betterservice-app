-- FLIP trade orders: a sale Craig enters by hand, at trade prices, that goes
-- through the same order list, label sheet, stock and invoice numbering as a
-- web order.
--
-- WHY THIS EXISTS
--
-- Every FLIP order so far came through the website and Stripe, so every row in
-- flip_orders was paid before it existed. Trade is different. A dealer or a
-- trailer builder rings or emails, Craig agrees a price, the goods go out, and
-- the money arrives later on an invoice. There was nowhere to put that sale
-- except a spreadsheet, which means it would miss stock, miss the FLIP number
-- sequence, miss the label sheet and miss the reports — the four things the
-- web order already gets for free.
--
-- It also covers DROPSHIP: the trade customer is who PAYS (bill_to, gets the
-- invoice) and the delivery address is wherever the parcel GOES (their
-- customer). Those were the same person on every web order, so the table never
-- had to tell them apart. Now it does.
--
-- And it covers the DEALER PORTAL: saved dealers (flip_dealers) on price tiers,
-- who can log in at flipbikes.co.nz/trade and place those dropship orders
-- themselves, on account. Their orders come through the same function as
-- Craig's, so they land on the same pack list with the same numbering.
--
-- THE ONE RULE THIS FILE IS BUILT AROUND
--
-- The dashboard still gets NO insert on flip_orders. The only way to create a
-- trade order is create_flip_trade_order(), a security-definer function that
--   - refuses anyone who is not an owner,
--   - takes prices EXCLUDING GST and works out GST and the total itself,
--   - names each product from its own table, not from what the browser said,
--   - takes the stock, and
--   - lets the identity column hand out the next FLIP number.
-- So a page that is wrong, or a request someone has edited, cannot invent a
-- total, skip the stock or claim a number. The browser sends what was ordered;
-- the database decides what it costs.
--
-- PRICES EXCLUDE GST ON THE WAY IN, AND THE ROW STAYS GST-INCLUSIVE.
--
-- NZ trade pricing is quoted excluding GST, and that is what Craig types. But
-- every existing column — amount_total, shipping_amount, freight_cost — is
-- GST INCLUSIVE, and the reports page sums them that way. Typing an ex-GST
-- figure into an inclusive column would under-charge every trade order by 15%
-- and look plausible the whole time. So trade orders keep amount_total and
-- shipping_amount inclusive like everything else, and ALSO record the ex-GST
-- figures and the GST exactly as invoiced, so the invoice never has to
-- re-derive a number that the reports already used.
--
-- GST is 15% of the ex-GST total, rounded ONCE on the total — not per line —
-- so the invoice's subtotal + GST = total, to the cent, every time.
--
-- NOTHING HERE IS DROPPED. The Supabase MCP tool hangs on any DROP verb, so
-- policies are created behind existence checks instead of drop-and-recreate.

-- ------------------------------------------------------------ trade prices
--
-- One row per product. The NAME lives here too, so the order function can name
-- a line itself rather than trusting the browser's label for it. The price is
-- nullable on purpose: a product Craig has not priced for trade yet refuses to
-- go on an order until he does, rather than going out at $0.

create table if not exists public.flip_trade_prices (
  sku          text primary key,
  name         text not null,
  price_ex_gst integer,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff(id)
);

comment on table public.flip_trade_prices is
  'Craig''s trade price list. price_ex_gst is in cents EXCLUDING GST. Null = not priced for trade yet; such a product cannot go on a trade order until it is.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flip_trade_prices_price_not_negative') then
    alter table public.flip_trade_prices
      add constraint flip_trade_prices_price_not_negative
      check (price_ex_gst is null or price_ex_gst >= 0);
  end if;
end $$;

-- Same SKUs and names as the shop's catalog (Flipbikes api/_lib/catalog.js).
-- Unpriced until Craig enters his list. Re-running updates names, never prices.
insert into public.flip_trade_prices (sku, name) values
  ('flip-standard',     'FLIP Standard Bike Chock'),
  ('flip-g3',           'FLIP G3 Bike Chock'),
  ('flip-road',         'FLIP Road Bike Chock'),
  ('flip-starter-pack', 'FLIP Starter Pack (1x Standard chock, 2x D rings, 2x tie-downs)'),
  ('d-rings',           'D Rings'),
  ('tie-downs',         'Tie Downs')
on conflict (sku) do update set name = excluded.name;

alter table public.flip_trade_prices enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'flip_trade_prices' and policyname = 'flip_trade_prices_owner_read') then
    create policy flip_trade_prices_owner_read on public.flip_trade_prices
      for select to authenticated using (public.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'flip_trade_prices' and policyname = 'flip_trade_prices_owner_price') then
    create policy flip_trade_prices_owner_price on public.flip_trade_prices
      for update to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
end $$;

-- Trade prices are a cost-side number and must never be readable outside the
-- owners. `from public, anon` matters — see 0076 for what revoking from anon
-- alone does (nothing).
revoke all on public.flip_trade_prices from public, anon, authenticated;
grant select                                          on public.flip_trade_prices to authenticated;
grant update (price_ex_gst, updated_at, updated_by)   on public.flip_trade_prices to authenticated;

-- ------------------------------------------------------------- price tiers
--
-- A few price levels (Standard, and whatever else Craig makes: Gold, Volume…),
-- and each dealer is put on one. STANDARD IS flip_trade_prices — the list
-- above — so there is one base price per product and nothing to keep in step.
-- Any other tier only stores the products where it differs; a product with no
-- row for that tier is charged at Standard. So a new tier starts as "same as
-- Standard" and Craig only types the prices he wants to change.

create table if not exists public.flip_price_tiers (
  id         text primary key,
  name       text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flip_price_tiers_id_slug') then
    alter table public.flip_price_tiers
      add constraint flip_price_tiers_id_slug check (id ~ '^[a-z0-9-]{1,30}$');
  end if;
end $$;

insert into public.flip_price_tiers (id, name, sort) values ('standard', 'Standard', 0)
on conflict (id) do nothing;

create table if not exists public.flip_tier_prices (
  tier_id      text not null references public.flip_price_tiers(id) on delete cascade,
  sku          text not null references public.flip_trade_prices(sku),
  price_ex_gst integer not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff(id),
  primary key (tier_id, sku)
);

comment on table public.flip_tier_prices is
  'Where a price tier differs from Standard (flip_trade_prices), in cents EXCLUDING GST. No row = Standard price. Standard itself never has rows here.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flip_tier_prices_not_negative') then
    alter table public.flip_tier_prices
      add constraint flip_tier_prices_not_negative check (price_ex_gst >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flip_tier_prices_not_standard') then
    alter table public.flip_tier_prices
      add constraint flip_tier_prices_not_standard check (tier_id <> 'standard');
  end if;
end $$;

-- ------------------------------------------------------------------ dealers
--
-- Trade customers Craig has saved. Two uses:
--   * on a trade order he enters, picking the dealer fills in who pays and
--     prices it from their tier;
--   * with portal_access on, the dealer can log in at flipbikes.co.nz/trade
--     with this email and place dropship orders themselves.
--
-- A dealer is NOT a user of this database. They never get a Supabase login:
-- the portal's session is checked by flipbikes.co.nz, which talks to the
-- database with its own key and only through create_flip_dealer_order() and
-- flip_dealer_price_list(). Everything else in here — every customer, job and
-- invoice of the workshop — stays out of a dealer's reach by not being
-- reachable from where they are at all, rather than by a policy being right.

create table if not exists public.flip_dealers (
  id              uuid primary key default gen_random_uuid(),
  business        text not null,
  contact         text,
  email           text not null,
  phone           text,
  address         text,
  tier_id         text not null default 'standard' references public.flip_price_tiers(id),
  portal_access   boolean not null default false,
  -- Bumped to sign a dealer out everywhere (e.g. a lost phone). The portal's
  -- session carries the number it was issued under and stops working when
  -- this moves on.
  session_version integer not null default 1,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.staff(id)
);

create unique index if not exists flip_dealers_email_unique on public.flip_dealers (lower(email));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flip_dealers_email_shape') then
    alter table public.flip_dealers
      add constraint flip_dealers_email_shape check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;
  -- Stored lower-case, so the portal can look a dealer up by plain equality
  -- and two spellings of one address can never be two accounts.
  if not exists (select 1 from pg_constraint where conname = 'flip_dealers_email_lower') then
    alter table public.flip_dealers
      add constraint flip_dealers_email_lower check (email = lower(btrim(email)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flip_dealers_business_present') then
    alter table public.flip_dealers
      add constraint flip_dealers_business_present check (btrim(business) <> '');
  end if;
end $$;

-- Portal login codes. A six-digit code emailed to the dealer, stored hashed,
-- good for ten minutes and five guesses. Only flipbikes.co.nz's server key
-- touches this table; no one signed in to the dashboard needs it.
create table if not exists public.flip_dealer_codes (
  id         bigint generated always as identity primary key,
  dealer_id  uuid not null references public.flip_dealers(id) on delete cascade,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts   integer not null default 0,
  used_at    timestamptz
);
create index if not exists flip_dealer_codes_dealer_idx on public.flip_dealer_codes (dealer_id, created_at desc);

alter table public.flip_price_tiers  enable row level security;
alter table public.flip_tier_prices  enable row level security;
alter table public.flip_dealers      enable row level security;
alter table public.flip_dealer_codes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'flip_price_tiers' and policyname = 'flip_price_tiers_owner') then
    create policy flip_price_tiers_owner on public.flip_price_tiers
      for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'flip_tier_prices' and policyname = 'flip_tier_prices_owner') then
    create policy flip_tier_prices_owner on public.flip_tier_prices
      for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'flip_dealers' and policyname = 'flip_dealers_owner') then
    create policy flip_dealers_owner on public.flip_dealers
      for all to authenticated using (public.is_owner()) with check (public.is_owner());
  end if;
  -- flip_dealer_codes: deliberately no policy. RLS on with no policy means
  -- nobody but the service role reads it.
end $$;

revoke all on public.flip_price_tiers  from public, anon, authenticated;
revoke all on public.flip_tier_prices  from public, anon, authenticated;
revoke all on public.flip_dealers      from public, anon, authenticated;
revoke all on public.flip_dealer_codes from public, anon, authenticated;

grant select, insert                       on public.flip_price_tiers to authenticated;
grant update (name, sort)                  on public.flip_price_tiers to authenticated;
grant select, insert, delete               on public.flip_tier_prices to authenticated;
grant update (price_ex_gst, updated_at, updated_by) on public.flip_tier_prices to authenticated;
grant select, insert                       on public.flip_dealers     to authenticated;
grant update (business, contact, email, phone, address, tier_id, portal_access,
              session_version, notes, updated_at)
                                           on public.flip_dealers     to authenticated;
-- No DELETE on dealers: an order points at the dealer it was for. Turning
-- portal_access off is how a dealer is "removed".

-- ------------------------------------------------------- trade order columns

alter table public.flip_orders
  add column if not exists channel         text not null default 'web',
  add column if not exists bill_to         jsonb,
  add column if not exists due_date        date,
  add column if not exists paid_at         timestamptz,
  add column if not exists amount_ex_gst   integer,
  add column if not exists gst_amount      integer,
  add column if not exists shipping_ex_gst integer,
  add column if not exists dealer_id       uuid references public.flip_dealers(id),
  add column if not exists placed_via      text,
  add column if not exists customer_ref    text;

comment on column public.flip_orders.channel is
  '''web'' = paid through the website and Stripe. ''trade'' = entered by hand by an owner at trade prices.';
comment on column public.flip_orders.bill_to is
  'Trade orders only: who PAYS and receives the invoice {business, contact, email, phone, address}. The delivery address (address, name, phone) is where the parcel GOES, which for a dropship order is the trade customer''s own customer.';
comment on column public.flip_orders.due_date is
  'Trade orders only: when the invoice is due.';
comment on column public.flip_orders.paid_at is
  'Trade orders only: when payment was received. Null on a trade order = awaiting payment. Web orders leave it null; they are paid by construction.';
comment on column public.flip_orders.amount_ex_gst is
  'Trade orders only: goods + freight EXCLUDING GST, in cents, exactly as invoiced.';
comment on column public.flip_orders.gst_amount is
  'Trade orders only: the GST on the invoice, 15% of amount_ex_gst rounded once. amount_ex_gst + gst_amount = amount_total.';
comment on column public.flip_orders.shipping_ex_gst is
  'Trade orders only: freight charged EXCLUDING GST. At cost by default — the carrier''s own quote with no markup.';

comment on column public.flip_orders.dealer_id is
  'Trade orders only: the saved dealer (flip_dealers) it was for, if any.';
comment on column public.flip_orders.placed_via is
  'Trade orders only: ''dashboard'' = Craig entered it; ''portal'' = the dealer placed it themselves at flipbikes.co.nz/trade.';
comment on column public.flip_orders.customer_ref is
  'Trade orders only: the dealer''s own order or PO reference, printed on the invoice.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'flip_orders_placed_via_known') then
    alter table public.flip_orders
      add constraint flip_orders_placed_via_known check (placed_via is null or placed_via in ('dashboard', 'portal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flip_orders_channel_known') then
    alter table public.flip_orders
      add constraint flip_orders_channel_known check (channel in ('web', 'trade'));
  end if;
end $$;

-- The list asks "what trade money is outstanding" every time it loads.
create index if not exists flip_orders_trade_unpaid_idx
  on public.flip_orders (due_date)
  where channel = 'trade' and paid_at is null;

-- An owner may record that a trade invoice has been paid. Nothing else new.
-- The 0077 UPDATE policy already limits rows to owners; this limits columns.
grant update (paid_at) on public.flip_orders to authenticated;

-- ---------------------------------------------------------- the one way in

-- The work, shared by the two doors below. Not callable by anyone directly:
-- create_flip_trade_order() is Craig's door (owner check), and
-- create_flip_dealer_order() is the portal's (server key only). Both end up
-- here, so a dealer's order and Craig's are priced, numbered, stocked and
-- stored by the same lines of code.
create or replace function public.flip_trade_order_core(p_order jsonb, p_dealer_id uuid, p_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_portal    boolean := p_via = 'portal';
  v_dealer    public.flip_dealers%rowtype;
  v_tier      text    := 'standard';
  v_ref       text;
  v_bill      jsonb   := coalesce(p_order->'bill_to', '{}'::jsonb);
  v_ship      jsonb   := coalesce(p_order->'deliver_to', '{}'::jsonb);
  v_lines     jsonb   := coalesce(p_order->'lines', '[]'::jsonb);
  v_collect   boolean := coalesce(p_order->>'collect', 'false') = 'true';
  v_paid      boolean := coalesce(p_order->>'paid', 'false') = 'true';
  v_line      jsonb;
  v_sku       text;
  v_qty       integer;
  v_unit      integer;
  v_name      text;
  v_items     jsonb   := '[]'::jsonb;
  v_goods_ex  bigint  := 0;
  v_ship_ex   integer := 0;
  v_ex        bigint;
  v_gst       integer;
  v_total     integer;
  v_postcode  text;
  v_due       date;
  v_source    text;
  v_carrier   text;
  v_quoted    integer;
  v_session   text;
  v_invoice   bigint;
  v_left      jsonb   := '{}'::jsonb;
  v_remaining integer;
  v_address   jsonb;
begin
  if p_via is null or p_via not in ('dashboard', 'portal') then
    raise exception 'Unknown order channel.';
  end if;

  -- ---- the saved dealer, if there is one: decides the price tier.
  if p_dealer_id is not null then
    select * into v_dealer from flip_dealers where id = p_dealer_id;
    if not found then
      raise exception 'That dealer account no longer exists.';
    end if;
    v_tier := v_dealer.tier_id;
  end if;

  -- ---- an order from the portal. Who pays comes from the saved account,
  -- never from the request: a dealer cannot bill someone else, or change the
  -- email their invoice goes to, by editing what their browser sends.
  if v_portal then
    if p_dealer_id is null then
      raise exception 'A portal order needs a dealer.';
    end if;
    if not v_dealer.portal_access then
      raise exception 'This dealer account does not have portal access.' using errcode = '42501';
    end if;
    if v_collect then
      raise exception 'Collections are arranged with us directly. Please get in touch.';
    end if;
    v_bill := jsonb_build_object(
      'business', v_dealer.business, 'contact', v_dealer.contact, 'email', v_dealer.email,
      'phone', v_dealer.phone, 'address', v_dealer.address);
    v_paid := false;
  end if;

  v_ref := nullif(left(btrim(coalesce(p_order->>'customer_ref', '')), 60), '');

  -- ---- who pays. The invoice is emailed, so an address is not optional.
  if coalesce(btrim(v_bill->>'business'), '') = '' then
    raise exception 'Enter the trade customer''s business name.';
  end if;
  if coalesce(btrim(v_bill->>'email'), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'The invoice is emailed, so the trade customer needs a valid email address.';
  end if;

  -- ---- where it goes. Not asked for when the customer collects.
  if not v_collect then
    v_postcode := btrim(coalesce(v_ship->>'postcode', ''));
    if coalesce(btrim(v_ship->>'name'), '') = ''
       or coalesce(btrim(v_ship->>'line1'), '') = ''
       or coalesce(btrim(v_ship->>'city'), '') = '' then
      raise exception 'Fill in who it is going to, the street, and the town or city.';
    end if;
    if v_postcode !~ '^\d{4}$' then
      raise exception 'The delivery postcode must be 4 digits.';
    end if;
  end if;

  -- ---- what was ordered. Named and (by default) priced from our own table.
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Add at least one product.';
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_sku := v_line->>'sku';
    -- The dealer's tier price where it has one, Standard where it doesn't.
    select tp.name, coalesce(tt.price_ex_gst, tp.price_ex_gst) into v_name, v_unit
      from flip_trade_prices tp
      left join flip_tier_prices tt on tt.sku = tp.sku and tt.tier_id = v_tier
     where tp.sku = v_sku;
    if not found then
      raise exception 'Unknown product: %', coalesce(v_sku, '(none)');
    end if;

    if coalesce(v_line->>'qty', '') !~ '^\d+$' then
      raise exception 'Quantity for % must be a whole number.', v_name;
    end if;
    v_qty := (v_line->>'qty')::integer;
    if v_qty < 1 or v_qty > 1000 then
      raise exception 'Quantity for % must be between 1 and 1000.', v_name;
    end if;

    -- A price typed on the order wins over the list; the list is the default.
    -- Never from the portal: a dealer pays their tier's price, whatever the
    -- request says.
    if not v_portal and nullif(v_line->>'unit_ex_gst', '') is not null then
      if (v_line->>'unit_ex_gst') !~ '^\d+$' then
        raise exception 'Price for % must be in whole cents, not negative.', v_name;
      end if;
      v_unit := (v_line->>'unit_ex_gst')::integer;
    end if;
    if v_unit is null and v_portal then
      raise exception '% is not available to order online yet. Please get in touch.', v_name;
    end if;
    if v_unit is null then
      raise exception 'No trade price for %. Set one on the trade prices page or type it on the order.', v_name;
    end if;

    v_goods_ex := v_goods_ex + v_unit::bigint * v_qty;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'sku', v_sku,
      'name', v_name,
      'qty', v_qty,
      'unit_ex_gst', v_unit,
      -- Kept GST-inclusive per unit too, so anything that reads a web order's
      -- unit_amount still gets a sensible number from a trade one.
      'unit_amount', round(v_unit * 1.15)::integer
    ));
  end loop;

  -- ---- freight, excluding GST. At cost by default; Craig may change it.
  if not v_collect then
    if coalesce(p_order->>'shipping_ex_gst', '') !~ '^\d+$' then
      raise exception 'Enter the freight in cents, or 0 for free freight.';
    end if;
    v_ship_ex := (p_order->>'shipping_ex_gst')::integer;

    -- What the form was QUOTED, recorded as 0088 defines it. Not "what was
    -- charged" — Craig can override the figure, and the gap between quoted and
    -- charged is itself worth being able to see.
    v_source := nullif(p_order->>'shipping_source', '');
    if v_source is not null and v_source not in ('carrier', 'table') then
      v_source := null;
    end if;
    v_carrier := nullif(left(coalesce(p_order->>'shipping_carrier', ''), 60), '');
    if coalesce(p_order->>'shipping_quoted_cents', '') ~ '^\d+$' then
      v_quoted := (p_order->>'shipping_quoted_cents')::integer;
    end if;
  end if;

  -- ---- money. GST once, on the whole ex-GST total.
  v_ex    := v_goods_ex + v_ship_ex;
  v_gst   := round(v_ex * 0.15)::integer;
  v_total := (v_ex + v_gst)::integer;

  -- ---- when it is due. Not needed if it was paid on the spot.
  -- A portal order is on account: the 20th of next month, by the NEW ZEALAND
  -- calendar (UTC is a day behind for half of every NZ morning).
  if v_portal then
    v_due := (date_trunc('month', now() at time zone 'Pacific/Auckland') + interval '1 month')::date + 19;
  elsif nullif(p_order->>'due_date', '') is not null then
    v_due := (p_order->>'due_date')::date;
  elsif not v_paid then
    raise exception 'Set a due date for the invoice.';
  end if;

  -- ---- the delivery block, in the same shape a web order's address takes, so
  -- the label sheet and pick ticket need no special case to print it.
  if v_collect then
    v_address := jsonb_build_object(
      'formatted', null, 'postcode', null, 'rural', false, 'ruralWhy', null,
      'note', nullif(btrim(coalesce(v_ship->>'note', '')), ''),
      'typed', true, 'collect', true);
  else
    v_address := jsonb_build_object(
      'formatted', concat_ws(', ',
          btrim(v_ship->>'line1'),
          nullif(btrim(coalesce(v_ship->>'suburb', '')), ''),
          -- "Hamilton 3214", as the web checkout's address lookup writes it.
          btrim(v_ship->>'city') || ' ' || v_postcode,
          'New Zealand'),
      'postcode', v_postcode,
      'rural',    coalesce(v_ship->>'rural', 'false') = 'true',
      'ruralWhy', case when coalesce(v_ship->>'rural', 'false') = 'true' then 'declared' end,
      'note',     nullif(btrim(coalesce(v_ship->>'note', '')), ''),
      'typed',    true,
      'collect',  false);
  end if;

  v_session := 'trade_' || replace(gen_random_uuid()::text, '-', '');

  insert into flip_orders (
    session_id, name, email, phone, country, address, items,
    amount_total, shipping_amount, stock_taken, emailed,
    channel, bill_to, due_date, paid_at,
    amount_ex_gst, gst_amount, shipping_ex_gst,
    shipping_source, shipping_carrier, shipping_quoted_cents,
    dealer_id, placed_via, customer_ref)
  values (
    v_session,
    case when v_collect then btrim(v_bill->>'business') else btrim(v_ship->>'name') end,
    null,
    nullif(btrim(coalesce(case when v_collect then v_bill->>'phone' else v_ship->>'phone' end, '')), ''),
    'NZ',
    v_address,
    v_items,
    v_total,
    v_ship_ex + round(v_ship_ex * 0.15)::integer,
    false, false,
    'trade',
    jsonb_build_object(
      'business', btrim(v_bill->>'business'),
      'contact',  nullif(btrim(coalesce(v_bill->>'contact', '')), ''),
      'email',    lower(btrim(v_bill->>'email')),
      'phone',    nullif(btrim(coalesce(v_bill->>'phone', '')), ''),
      'address',  nullif(btrim(coalesce(v_bill->>'address', '')), '')),
    v_due,
    case when v_paid then now() end,
    v_ex, v_gst, v_ship_ex,
    v_source, v_carrier, v_quoted,
    p_dealer_id, p_via, v_ref)
  returning invoice_number into v_invoice;

  -- ---- stock, through the same function the website uses, so the two
  -- channels can never disagree about what is on the shelf.
  for v_line in select value from jsonb_array_elements(v_items) loop
    select public.flip_take_stock(v_line->>'sku', (v_line->>'qty')::integer) into v_remaining;
    v_left := v_left || jsonb_build_object(v_line->>'sku', v_remaining);
  end loop;
  update flip_orders set stock_taken = true where session_id = v_session;

  return jsonb_build_object(
    'session_id',     v_session,
    'invoice_number', v_invoice,
    'amount_ex_gst',  v_ex,
    'gst_amount',     v_gst,
    'amount_total',   v_total,
    'stock_left',     v_left);
end;
$$;

comment on function public.flip_trade_order_core(jsonb, uuid, text) is
  'Shared body of create_flip_trade_order and create_flip_dealer_order. Callable by neither owners nor dealers directly.';

revoke all on function public.flip_trade_order_core(jsonb, uuid, text) from public, anon, authenticated;

-- Craig's door. Optional p_order.dealer_id links the order to a saved dealer
-- and prices it from their tier; what he types still wins, line by line.
create or replace function public.create_flip_trade_order(p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only an owner can create a trade order.' using errcode = '42501';
  end if;
  return public.flip_trade_order_core(
    p_order, nullif(p_order->>'dealer_id', '')::uuid, 'dashboard');
end;
$$;

comment on function public.create_flip_trade_order(jsonb) is
  'How an owner creates a trade order. Prices in cents EXCLUDING GST; GST and totals are computed in flip_trade_order_core, not taken from the caller.';

-- The portal's door. flipbikes.co.nz calls it with its server key after
-- checking the dealer's own session, and passes the freight IT quoted — never
-- a figure from the dealer's browser.
create or replace function public.create_flip_dealer_order(p_dealer_id uuid, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.flip_trade_order_core(p_order, p_dealer_id, 'portal');
end;
$$;

comment on function public.create_flip_dealer_order(uuid, jsonb) is
  'How a dealer''s portal order is created. Server key only. Bill-to and prices come from the saved dealer and their tier.';

-- What a dealer sees on the portal: every product, at their price.
create or replace function public.flip_dealer_price_list(p_dealer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'sku', tp.sku, 'name', tp.name,
           'price_ex_gst', coalesce(tt.price_ex_gst, tp.price_ex_gst))
         order by tp.sku), '[]'::jsonb)
    from flip_trade_prices tp
    join flip_dealers d on d.id = p_dealer_id
    left join flip_tier_prices tt on tt.sku = tp.sku and tt.tier_id = d.tier_id;
$$;

revoke all on function public.create_flip_dealer_order(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.flip_dealer_price_list(uuid)          from public, anon, authenticated;
grant execute on function public.create_flip_dealer_order(uuid, jsonb) to service_role;
grant execute on function public.flip_dealer_price_list(uuid)          to service_role;

-- A new function is executable by PUBLIC by default, which includes anon.
-- The owner check inside would still refuse, but nothing outside the owners
-- should be able to reach it at all.
revoke all on function public.create_flip_trade_order(jsonb) from public, anon;
grant execute on function public.create_flip_trade_order(jsonb) to authenticated;

-- ---------------------------------------------------------------- checks
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['channel','bill_to','due_date','paid_at','amount_ex_gst','gst_amount','shipping_ex_gst']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'flip_orders' and column_name = c);
  if v_missing is not null then
    raise exception 'these flip_orders columns were not added: %', v_missing;
  end if;

  if (select count(*) from public.flip_trade_prices) < 6 then
    raise exception 'the trade price list was not seeded';
  end if;

  -- Still no way to write an order row directly from the app.
  if has_table_privilege('authenticated', 'public.flip_orders', 'INSERT') then
    raise exception 'authenticated can insert flip_orders directly — the order function would be bypassable';
  end if;
  if has_column_privilege('authenticated', 'public.flip_orders', 'amount_total', 'UPDATE') then
    raise exception 'authenticated can rewrite amount_total';
  end if;
  if has_column_privilege('authenticated', 'public.flip_orders', 'gst_amount', 'UPDATE') then
    raise exception 'authenticated can rewrite gst_amount';
  end if;
  if not has_column_privilege('authenticated', 'public.flip_orders', 'paid_at', 'UPDATE') then
    raise exception 'owners cannot mark a trade invoice paid';
  end if;

  -- Stock is only ever taken by trusted code.
  if has_function_privilege('authenticated', 'public.flip_take_stock(text, integer)', 'EXECUTE') then
    raise exception 'authenticated can call flip_take_stock directly';
  end if;

  if not has_function_privilege('authenticated', 'public.create_flip_trade_order(jsonb)', 'EXECUTE') then
    raise exception 'owners cannot create a trade order';
  end if;
  if has_function_privilege('anon', 'public.create_flip_trade_order(jsonb)', 'EXECUTE') then
    raise exception 'anon can call create_flip_trade_order';
  end if;

  if has_table_privilege('anon', 'public.flip_trade_prices', 'SELECT') then
    raise exception 'anon can read trade prices — that is a cost-side number';
  end if;
  if has_column_privilege('authenticated', 'public.flip_trade_prices', 'sku', 'UPDATE') then
    raise exception 'authenticated can rename a trade price SKU';
  end if;

  if has_function_privilege('authenticated', 'public.create_flip_dealer_order(uuid, jsonb)', 'EXECUTE') then
    raise exception 'a signed-in user can place an order as any dealer';
  end if;
  if has_function_privilege('authenticated', 'public.flip_trade_order_core(jsonb, uuid, text)', 'EXECUTE') then
    raise exception 'the order core is callable without the owner check';
  end if;
  if has_function_privilege('anon', 'public.flip_dealer_price_list(uuid)', 'EXECUTE') then
    raise exception 'anon can read a dealer''s prices';
  end if;
  if has_table_privilege('authenticated', 'public.flip_dealer_codes', 'SELECT') then
    raise exception 'login codes are readable from the dashboard';
  end if;
  if has_table_privilege('anon', 'public.flip_dealers', 'SELECT') then
    raise exception 'anon can read the dealer list';
  end if;
  if not has_function_privilege('service_role', 'public.create_flip_dealer_order(uuid, jsonb)', 'EXECUTE') then
    raise exception 'the portal cannot place orders';
  end if;
  if has_table_privilege('anon', 'public.flip_orders', 'SELECT') then
    raise exception 'anon can read flip_orders';
  end if;
  if not has_table_privilege('service_role', 'public.flip_orders', 'INSERT') then
    raise exception 'the shop can no longer write web orders';
  end if;
end $$;
