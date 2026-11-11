-- FLIP sales into the Betterservice books.
--
-- FLIP is a trading name of Betterservice ATV (Ben, 11 Nov 2026: "it's all
-- the same, just a trading name for selling the chocks"). Same GST number,
-- same bank account. Until now every FLIP sale lived only in flip_orders and
-- never reached the ledger, so the books, the P&L and the GST figures were
-- all missing the chock income. This posts it.
--
-- WHAT GETS POSTED (account codes from 0003)
--
--   Website order (paid by card before it exists):
--     Dr 100 Business Bank Account     total incl GST
--     Cr 450 Sales — FLIP              total excl GST
--     Cr 200 GST                       3/23 of the total (0 if zero-rated)
--   Trade order (invoiced on account):
--     Dr 110 Accounts Receivable       total incl GST
--     Cr 450 Sales — FLIP              amount_ex_gst
--     Cr 200 GST                       gst_amount
--   Trade order marked paid:
--     Dr 100 Business Bank Account     total
--     Cr 110 Accounts Receivable       total
--
-- Freight charged to the customer is part of the sale. What the COURIER
-- costs is deliberately NOT posted from here: GoSweetSpot bills it, and that
-- bill goes in as an expense like any supplier's. Posting freight_cost too
-- would count every docket twice.
--
-- Card payments go straight to the bank account, as counter sales already
-- do. Stripe's fee is not recorded here; it shows on the Stripe payout and
-- belongs in the books as an expense when the payouts are reconciled.
--
-- WHAT IS NOT POSTED
--
--   * Stripe TEST orders (session_id cs_test_...), written by preview
--     deployments into this same table. FLIP-1001 is one.
--   * Anything with a zero total.
--
-- IT MUST NEVER COST AN ORDER
--
-- The post runs in a trigger on flip_orders, so a failure would roll back the
-- INSERT — and a website order whose row is refused is a paid customer with
-- no order. So the trigger catches every error, records it in
-- flip_ledger_problems for someone to look at, and lets the order through.
-- Posting is idempotent: re-running flip_ledger_post for an order that is
-- already in the books does nothing.

-- ------------------------------------------------------------ the account
insert into public.accounts (code, name, type, description)
values ('450', 'Sales — FLIP', 'income', 'FLIP Bike Chocks: website and trade sales, freight included, excluding GST.')
on conflict (code) do nothing;

-- ------------------------------------------- an id the ledger can point at
-- journal_entries.source_id is a uuid; flip_orders' key is Stripe's session
-- id, which is text. A stable uuid per order bridges the two.
alter table public.flip_orders
  add column if not exists ledger_id uuid not null default gen_random_uuid();
create unique index if not exists flip_orders_ledger_id_key on public.flip_orders (ledger_id);

comment on column public.flip_orders.ledger_id is
  'Stable id for this order in the ledger (journal_entries.source_id, source_type flip_sale / flip_payment).';

-- ------------------------------------------------ where failures are kept
create table if not exists public.flip_ledger_problems (
  id         bigint generated always as identity primary key,
  session_id text not null,
  error      text not null,
  created_at timestamptz not null default now()
);
alter table public.flip_ledger_problems enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'flip_ledger_problems' and policyname = 'flip_ledger_problems_owner_read') then
    create policy flip_ledger_problems_owner_read on public.flip_ledger_problems
      for select to authenticated using (public.is_owner());
  end if;
end $$;
revoke all on public.flip_ledger_problems from public, anon, authenticated;
grant select on public.flip_ledger_problems to authenticated;

-- ------------------------------------------------------------- the poster
create or replace function public.flip_ledger_post(p_session text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o        public.flip_orders%rowtype;
  v_no     text;
  v_total  numeric;
  v_gst    numeric;
  v_ex     numeric;
  v_lines  jsonb;
begin
  select * into o from flip_orders where session_id = p_session;
  if not found then return; end if;
  if o.session_id like 'cs_test_%' then return; end if;
  if coalesce(o.amount_total, 0) <= 0 then return; end if;

  v_no    := 'FLIP-' || o.invoice_number;
  v_total := round(o.amount_total / 100.0, 2);

  -- ---- the sale
  if not exists (select 1 from journal_entries je
                  where je.source_type = 'flip_sale' and je.source_id = o.ledger_id
                    and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)) then
    if o.channel = 'trade' then
      -- The database already worked these out once (flip_trade_order_core);
      -- the books take the invoiced figures rather than re-deriving them.
      v_gst := round(coalesce(o.gst_amount, 0) / 100.0, 2);
      v_ex  := round(coalesce(o.amount_ex_gst, o.amount_total - coalesce(o.gst_amount, 0)) / 100.0, 2);
      v_lines := jsonb_build_array(jsonb_build_object('account_code', '110', 'debit', v_total,
                   'memo', v_no || ' ' || coalesce(o.bill_to->>'business', '')));
    else
      -- Same rule as the website invoice: 3/23 of the inclusive total,
      -- rounded to the cent; nothing for a zero-rated export to Australia.
      v_gst := case when o.country = 'AU' then 0 else round(round(o.amount_total * 3 / 23.0) / 100.0, 2) end;
      v_ex  := v_total - v_gst;
      v_lines := jsonb_build_array(jsonb_build_object('account_code', '100', 'debit', v_total,
                   'memo', v_no || ' ' || coalesce(o.name, '')));
    end if;
    if v_ex <> 0 then v_lines := v_lines || jsonb_build_object('account_code', '450', 'credit', v_ex); end if;
    if v_gst > 0 then v_lines := v_lines || jsonb_build_object('account_code', '200', 'credit', v_gst); end if;

    perform post_entry((o.created_at at time zone 'Pacific/Auckland')::date,
                       v_no || case when o.channel = 'trade' then ' (trade invoice)' else ' (website sale)' end,
                       'flip_sale', o.ledger_id, v_lines);
  end if;

  -- ---- a trade invoice being paid
  if o.channel = 'trade' and o.paid_at is not null
     and not exists (select 1 from journal_entries je
                      where je.source_type = 'flip_payment' and je.source_id = o.ledger_id
                        and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)) then
    perform post_entry((o.paid_at at time zone 'Pacific/Auckland')::date,
                       v_no || ' paid',
                       'flip_payment', o.ledger_id,
                       jsonb_build_array(
                         jsonb_build_object('account_code', '100', 'debit', v_total, 'memo', v_no),
                         jsonb_build_object('account_code', '110', 'credit', v_total, 'memo', v_no)));
  end if;
end;
$$;

comment on function public.flip_ledger_post(text) is
  'Posts a FLIP order (sale, and payment for a trade invoice) to the ledger. Idempotent. Skips Stripe test orders.';

revoke all on function public.flip_ledger_post(text) from public, anon, authenticated;

-- ------------------------------------------------------------ the trigger
create or replace function public.flip_ledger_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.flip_ledger_post(new.session_id);
  exception when others then
    -- Never fail the order. Keep the reason for someone to fix and re-run.
    insert into flip_ledger_problems (session_id, error) values (new.session_id, sqlerrm);
    raise warning 'FLIP ledger post failed for %: %', new.session_id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.flip_ledger_trigger() from public, anon, authenticated;

create or replace trigger flip_orders_ledger
  after insert or update of paid_at on public.flip_orders
  for each row execute function public.flip_ledger_trigger();

-- -------------------------------------------- the sales already made
-- post_entry() only lets staff or the server key post. A migration is
-- neither, so for this one transaction it posts as the server key would.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.flip_ledger_post(session_id) from public.flip_orders order by invoice_number;

-- ------------------------------------------------------------------ checks
do $$
declare
  v_missing int;
  v_bad     int;
begin
  -- every live order with money in it is in the books exactly once
  select count(*) into v_missing
    from flip_orders o
   where o.session_id not like 'cs_test_%' and coalesce(o.amount_total, 0) > 0
     and (select count(*) from journal_entries je where je.source_type = 'flip_sale' and je.source_id = o.ledger_id) <> 1;
  if v_missing > 0 then raise exception '% FLIP orders are not posted exactly once', v_missing; end if;

  if exists (select 1 from journal_entries je join flip_orders o on o.ledger_id = je.source_id
              where je.source_type = 'flip_sale' and o.session_id like 'cs_test_%') then
    raise exception 'a Stripe test order was posted to the books';
  end if;

  -- each FLIP sale's debit equals the order total
  select count(*) into v_bad
    from flip_orders o
    join journal_entries je on je.source_type = 'flip_sale' and je.source_id = o.ledger_id
   where round(o.amount_total / 100.0, 2) <> (select sum(debit) from journal_lines where entry_id = je.id);
  if v_bad > 0 then raise exception '% FLIP sales post a different total from the order', v_bad; end if;

  if has_function_privilege('authenticated', 'public.flip_ledger_post(text)', 'EXECUTE') then
    raise exception 'signed-in users can post FLIP orders to the books themselves';
  end if;
  if has_table_privilege('anon', 'public.flip_ledger_problems', 'SELECT') then
    raise exception 'anon can read ledger problems';
  end if;
end $$;
