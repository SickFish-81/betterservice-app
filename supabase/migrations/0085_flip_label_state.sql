-- FLIP orders: the shipment's own state, so a label can be created, fetched,
-- printed and — when it isn't — SEEN.
--
-- 0077 added `packed_at` and said why there was no tracking column yet: "an
-- empty column nobody fills is worse than no column." That is no longer true.
-- The NZ Post account is open and carded, the print agent is written
-- (tools/print-agent in the Flipbikes repo), and the two endpoints it polls
-- are being built against these columns. So they get filled.
--
-- WHY FIVE COLUMNS AND NOT A STATUS STRING
--
-- Same reasoning as 0077. Each of these is a FACT with a time attached, and
-- none of them can contradict another:
--
--   consignment_id    NZ Post has accepted the parcel and given it an id
--   tracking_number   what the customer can type into a tracking page
--   label_fetched_at  the PDF has actually been retrieved and stored
--   printed_at        PAPER CAME OUT OF THE PRINTER
--   label_error       why one of the above didn't happen, in plain words
--
-- `printed_at` is the important one, and it is the whole reason this is five
-- timestamps rather than one `status` column. It is the difference between "we
-- think it printed" and "it printed" — the same lesson as `emailed = true` not
-- meaning delivered, which has now bitten this project twice.
--
-- `label_error` exists because the failure mode here is physical. Printers are
-- offline, out of paper, asleep. The agent is built to leave a failed label
-- unprinted so the next poll retries it, and this column is how the shop finds
-- out rather than Craig noticing an order never went.
--
-- NOTHING IS DELETED OR DROPPED IN THIS FILE, on purpose: the Supabase MCP
-- tool hangs on any statement whose verb is DROP (see 0084's header). The
-- existing flip_orders policies and grants from 0077 already cover these
-- columns, because that migration granted SELECT on the whole table rather
-- than column by column — so an owner can read the label state with no new
-- grant, and still cannot write it. The shop and the agent write through the
-- service role.

alter table public.flip_orders
  add column if not exists consignment_id   text,
  add column if not exists tracking_number  text,
  add column if not exists label_fetched_at timestamptz,
  add column if not exists printed_at       timestamptz,
  add column if not exists label_error      text;

comment on column public.flip_orders.consignment_id is
  'NZ Post consignment id. Null = no label has been created for this order yet.';
comment on column public.flip_orders.tracking_number is
  'The tracking number to give the customer.';
comment on column public.flip_orders.label_fetched_at is
  'When the label PDF was retrieved from NZ Post and stored. Null = not fetched.';
comment on column public.flip_orders.printed_at is
  'When paper actually came out of the printer. Null = not printed. NOT "we asked it to print".';
comment on column public.flip_orders.label_error is
  'Why the label was not created, fetched or printed, in words a human can act on.';

-- What the print agent asks, every minute: what is waiting to print? A partial
-- index keeps that one question cheap, and stays tiny because rows leave it for
-- good once printed.
create index if not exists flip_orders_label_to_print_idx
  on public.flip_orders (created_at)
  where printed_at is null and consignment_id is not null;

-- IDEMPOTENCE, AT THE LEVEL THAT CANNOT BE ARGUED WITH.
--
-- A Stripe webhook can be delivered twice. Two consignments for one order
-- means two labels, two parcels' worth of charges, and one of them travelling
-- with nothing in it. The code will only create a consignment when
-- consignment_id is null — but code is where the mistake happens, so the
-- database refuses the same consignment id on two orders as well.
create unique index if not exists flip_orders_consignment_unique_idx
  on public.flip_orders (consignment_id)
  where consignment_id is not null;

-- ---------------------------------------------------------------- checks
-- 0076 only caught its own failure because it asserted. Same here.
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['consignment_id','tracking_number','label_fetched_at','printed_at','label_error']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'flip_orders'
                        and column_name = c);
  if v_missing is not null then
    raise exception 'these columns were not added: %', v_missing;
  end if;

  -- An owner must be able to SEE the label state, or the app cannot show that
  -- a label failed. 0077 granted SELECT on the table, not per column, so this
  -- should already be true — but that is exactly the kind of "should" worth
  -- asserting rather than assuming.
  if not has_column_privilege('authenticated', 'public.flip_orders', 'printed_at', 'SELECT') then
    raise exception 'owners cannot read printed_at — the app could not show a failed label';
  end if;

  -- And must NOT be able to write it. Printing is something that happened, not
  -- something anyone types in.
  if has_column_privilege('authenticated', 'public.flip_orders', 'printed_at', 'UPDATE') then
    raise exception 'authenticated can write printed_at — that column must only ever be set by the agent';
  end if;

  -- The one that matters most: the shop and the agent reach these rows through
  -- the service role.
  if not has_table_privilege('service_role', 'public.flip_orders', 'UPDATE') then
    raise exception 'the service role can no longer update flip_orders — no label could ever be recorded';
  end if;

  if has_table_privilege('anon', 'public.flip_orders', 'SELECT') then
    raise exception 'anon can read flip_orders — customer names and addresses are exposed';
  end if;
end $$;
