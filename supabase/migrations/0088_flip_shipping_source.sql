-- FLIP orders: WHO priced the freight — the carrier, or our own table.
--
-- WHY THIS EXISTS
--
-- The shop asks GoSweetSpot what the freight will cost and falls back to a
-- hand-kept table when the carrier cannot answer. That fallback is deliberate
-- and correct: a sale must never be lost to somebody else's outage, and the
-- customer must always see a price.
--
-- But it is SILENT. Nothing in the order says which of the two answered. If
-- GoSweetSpot stops responding on a Tuesday, every order that week is priced
-- off the table, the customer is charged, Craig books a ticket at a different
-- cost, and there is no way afterwards to say which orders were affected or by
-- how much. The only trace is a console line in Vercel that nobody opens.
--
-- That silence is not theoretical. In November it hid a broken address field
-- for four days from someone who had the logs, the tools and the source code
-- open in front of him. A new person packing orders has none of those.
--
-- So the order records what priced it. Three columns, each a fact:
--
--   shipping_source        'carrier' or 'table'. Null = priced before this
--                          existed, which is not the same as unknown today.
--   shipping_carrier       which carrier quoted, when one did.
--   shipping_quoted_cents  the carrier's own number, EXCLUDING GST and before
--                          our markup — the raw quote, kept so the reports page
--                          can compare three things rather than two: what the
--                          carrier quoted, what we charged, and what the
--                          docket actually said.
--
-- NOT A BOOLEAN. "is_live_price" would answer one question and foreclose the
-- next one, which is always "which carrier, and what did they say".

alter table public.flip_orders
  add column if not exists shipping_source       text,
  add column if not exists shipping_carrier      text,
  add column if not exists shipping_quoted_cents integer;

comment on column public.flip_orders.shipping_source is
  'Who priced the freight: ''carrier'' (a live GoSweetSpot quote) or ''table'' (our fallback rate table). Null = the order predates this column.';
comment on column public.flip_orders.shipping_carrier is
  'Which carrier gave the quote, when one did. Null when the table priced it.';
comment on column public.flip_orders.shipping_quoted_cents is
  'The carrier''s own quote in cents, EXCLUDING GST and before our markup. Null when the table priced it.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'flip_orders_shipping_source_known'
                    and conrelid = 'public.flip_orders'::regclass) then
    alter table public.flip_orders
      add constraint flip_orders_shipping_source_known
      check (shipping_source is null or shipping_source in ('carrier', 'table'));
  end if;
end $$;

-- The question the dashboard asks when something looks wrong: which recent
-- orders did the carrier NOT price? Cheap, and tiny — most orders will not
-- match once this is working.
create index if not exists flip_orders_table_priced_idx
  on public.flip_orders (created_at desc)
  where shipping_source = 'table';

-- ---------------------------------------------------------------- access
--
-- READ ONLY for the app. 0077's rule holds: RLS picks the rows, the column
-- grant picks the columns. These three are written by the shop through the
-- service role at checkout and are a record of what happened — nobody in the
-- dashboard gets to revise them afterwards. The existing table-wide SELECT
-- from 0077 already covers reading them, so there is no new grant here at all.
-- This block exists to say that the omission is deliberate.

-- ---------------------------------------------------------------- checks
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['shipping_source','shipping_carrier','shipping_quoted_cents']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'flip_orders'
                        and column_name = c);
  if v_missing is not null then
    raise exception 'these columns were not added: %', v_missing;
  end if;

  if not has_column_privilege('authenticated', 'public.flip_orders', 'shipping_source', 'SELECT') then
    raise exception 'the dashboard cannot read shipping_source — it could not warn anyone';
  end if;

  -- The point of the column is that it is a record. If the app can rewrite it,
  -- it is not a record.
  if has_column_privilege('authenticated', 'public.flip_orders', 'shipping_source', 'UPDATE') then
    raise exception 'authenticated can rewrite shipping_source';
  end if;

  if not has_table_privilege('service_role', 'public.flip_orders', 'INSERT') then
    raise exception 'the shop can no longer write orders';
  end if;

  if has_table_privilege('anon', 'public.flip_orders', 'SELECT') then
    raise exception 'anon can read flip_orders';
  end if;
end $$;
