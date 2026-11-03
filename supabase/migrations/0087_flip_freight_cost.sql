-- FLIP orders: what the freight ACTUALLY COST, as opposed to what we charged.
--
-- WHY THIS EXISTS
--
-- flip_orders already records `shipping_amount` — the freight the customer was
-- charged at checkout. Nothing anywhere records what Craig then paid the
-- courier. So the one question the shop cannot answer today is the only one
-- that matters about freight: are we making money on it or losing it?
--
-- It is not a rounding question. The charge comes from a hand-built staircase
-- in the Flipbikes repo (api/_lib/shipping.js) whose shape is wrong on purpose
-- — it bands by item count while the carrier bills linearly by the kilo. One
-- of those bands was out by $3.00 an order until last week, and the only
-- reason anyone noticed was a 21-page rate card read by hand. A column of real
-- numbers is how that gets caught the next time instead of the time after.
--
-- WHY NOT COMPUTE IT FROM THE RATE TABLE
--
-- Because that is our own estimate measured against our own estimate, and it
-- agrees with itself by construction. It cannot detect the case it exists to
-- detect. This project has now been bitten six times by a value that looked
-- authoritative because a layer nobody checked produced it — AuthGate against
-- the database, `emailed = true` against actual delivery, a printer accepting
-- a job it then binned. A typed-in number from the counter docket is worth
-- more than a derived one precisely because a human had to look at it.
--
-- WHY THREE COLUMNS
--
-- Same reasoning as 0077 and 0085. Each is a fact, and none can contradict
-- another:
--
--   freight_cost              what the courier charged, in cents, GST INCLUSIVE
--   freight_cost_entered_at   when someone typed it in
--   freight_cost_entered_by   who typed it in
--
-- GST-inclusive, to match `shipping_amount`, which is what the customer paid
-- including GST. Comparing a GST-exclusive cost against a GST-inclusive charge
-- would overstate the margin on every single order by 15% and look plausible
-- the whole time. If the ledger ever wants the ex-GST figure it can divide;
-- the stored number stays like-for-like with the thing it is compared against.
--
-- NULL MEANS NOT ENTERED. ZERO MEANS FREE.
--
-- These are different facts and the report depends on telling them apart. A
-- customer who collects from the workshop costs nothing to ship, and that is a
-- real zero that belongs in the average. An order nobody has costed yet must
-- be excluded from the average entirely, or the freight margin reads high and
-- improves every time someone forgets. Hence nullable with a >= 0 check,
-- rather than `default 0`.
--
-- NOT AUTOMATIC, AND THAT IS THE POINT FOR NOW. When the GoSweetSpot account
-- is live the real charge comes back with the consignment and the shop can
-- write this column through the service role without anyone typing. Until
-- then, Craig enters it off the docket. The column shape does not change when
-- that day comes — only who fills it.

alter table public.flip_orders
  add column if not exists freight_cost            integer,
  add column if not exists freight_cost_entered_at timestamptz,
  add column if not exists freight_cost_entered_by uuid references public.staff(id);

comment on column public.flip_orders.freight_cost is
  'What the courier actually charged for this parcel, in cents, GST INCLUSIVE, to match shipping_amount. Null = nobody has costed it yet. Zero = genuinely free (collected in person). These are different facts.';
comment on column public.flip_orders.freight_cost_entered_at is
  'When the freight cost was entered. Null = never entered.';
comment on column public.flip_orders.freight_cost_entered_by is
  'Which staff member entered it.';

-- A negative freight cost is a typo, not a refund. Refunds are a ledger
-- concern and do not belong in a column whose job is "what the docket said".
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'flip_orders_freight_cost_not_negative'
                    and conrelid = 'public.flip_orders'::regclass) then
    alter table public.flip_orders
      add constraint flip_orders_freight_cost_not_negative
      check (freight_cost is null or freight_cost >= 0);
  end if;
end $$;

-- The question the report asks every time it loads: which sent orders still
-- have no freight cost against them? That list is the prompt to go and enter
-- them, so it has to stay cheap and visible rather than being a full scan that
-- quietly gets slower until someone stops opening the page.
create index if not exists flip_orders_freight_uncosted_idx
  on public.flip_orders (created_at desc)
  where freight_cost is null;

-- ---------------------------------------------------------------- access
--
-- 0077 set the rule: RLS decides WHICH ROWS, the column grant decides WHICH
-- COLUMNS. An owner may stamp an order packed and may now record what the
-- freight cost; they still may not rewrite the customer's address or what they
-- were charged. GRANT UPDATE is additive, so the packed_at grant from 0077
-- survives this untouched — it is not restated here, because restating it
-- would make this file look like the authority on a grant it does not own.
--
-- No new policy. The owner SELECT and owner UPDATE policies from 0077 already
-- cover these columns; a policy cannot see columns at all.

grant update (freight_cost, freight_cost_entered_at, freight_cost_entered_by)
  on public.flip_orders to authenticated;

-- ---------------------------------------------------------------- checks
-- 0076 only caught its own failure because it asserted. Same here.
do $$
declare v_missing text;
begin
  select string_agg(c, ', ') into v_missing
    from unnest(array['freight_cost','freight_cost_entered_at','freight_cost_entered_by']) c
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'flip_orders'
                        and column_name = c);
  if v_missing is not null then
    raise exception 'these columns were not added: %', v_missing;
  end if;

  -- The owner must be able to write the cost, or the field is decoration.
  if not has_column_privilege('authenticated', 'public.flip_orders', 'freight_cost', 'UPDATE') then
    raise exception 'owners cannot enter a freight cost';
  end if;

  -- And must still be unable to write anything else. This is the assertion
  -- that actually earns its keep: a column grant is easy to widen by accident
  -- and nothing visible changes when you do.
  if has_column_privilege('authenticated', 'public.flip_orders', 'shipping_amount', 'UPDATE') then
    raise exception 'authenticated can rewrite shipping_amount — the charge must stay what the customer was charged';
  end if;
  if has_column_privilege('authenticated', 'public.flip_orders', 'amount_total', 'UPDATE') then
    raise exception 'authenticated can rewrite amount_total';
  end if;
  if has_column_privilege('authenticated', 'public.flip_orders', 'email', 'UPDATE') then
    raise exception 'authenticated can rewrite the customer email';
  end if;

  -- 0077's grant must have survived. If it did not, the pack button is dead
  -- and the only symptom is Craig pressing it and nothing happening.
  if not has_column_privilege('authenticated', 'public.flip_orders', 'packed_at', 'UPDATE') then
    raise exception 'the packed_at grant from 0077 was lost';
  end if;

  -- The constraint must be able to refuse a typo.
  if not exists (select 1 from pg_constraint
                  where conname = 'flip_orders_freight_cost_not_negative'
                    and conrelid = 'public.flip_orders'::regclass) then
    raise exception 'the non-negative check was not created';
  end if;

  if has_table_privilege('anon', 'public.flip_orders', 'SELECT') then
    raise exception 'anon can read flip_orders — customer names and addresses are exposed';
  end if;

  if not has_table_privilege('service_role', 'public.flip_orders', 'UPDATE') then
    raise exception 'the service role can no longer update flip_orders';
  end if;
end $$;
