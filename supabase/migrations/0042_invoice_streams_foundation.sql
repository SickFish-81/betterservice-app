-- ============================================================================
-- Betterservice ATV — three invoice streams: ATV / rentals / hireage (30 Aug 2026)
--
-- Until now an invoice could only reach a customer THROUGH a job card
-- (invoices.job_card_id -> job_cards.customer_id). That is true of workshop
-- work, but a monthly rent invoice has no job card, no machine and no workshop
-- job — and neither does a day's hireage. So an invoice gains its own
-- customer_id, and a `kind` that says which stream it belongs to.
--
-- Invoice numbering is untouched: invoice_number is a generated identity, so
-- all three streams keep drawing from the one chronological sequence.
--
-- Money stays server-side. Nothing here lets the browser set an amount; the
-- rental and hire generators are separate functions built on this foundation,
-- the same way generate_invoice() serves job cards today.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. An invoice can belong to a customer directly, and knows its stream.
alter table public.invoices
  add column if not exists customer_id uuid references public.customers(id),
  add column if not exists kind text not null default 'atv';

alter table public.invoices drop constraint if exists invoices_kind_check;
alter table public.invoices add constraint invoices_kind_check
  check (kind in ('atv', 'rental', 'hire'));

-- 2. Backfill. Every invoice that exists today is workshop work; its customer
--    is whoever the job card belongs to.
update public.invoices i
   set customer_id = j.customer_id
  from public.job_cards j
 where i.job_card_id = j.id
   and i.customer_id is null;

-- 3. An invoice must reach a customer one way or the other — directly, or via
--    its job card. Without this, a bad insert could produce an invoice with
--    nobody to send it to.
alter table public.invoices drop constraint if exists invoices_has_a_customer;
alter table public.invoices add constraint invoices_has_a_customer
  check (customer_id is not null or job_card_id is not null);

-- 4. A three-day payment window. Rent is collected by automatic payment, so the
--    date is not what makes the money arrive — but the document has to state a
--    window, so it needs to be a real term rather than free text.
alter table public.invoices drop constraint if exists invoices_payment_terms_check;
alter table public.invoices add constraint invoices_payment_terms_check
  check (payment_terms in ('on_invoice', 'days_3', 'days_7', 'twentieth'));

alter table public.shop_settings drop constraint if exists shop_settings_default_payment_terms_check;
alter table public.shop_settings add constraint shop_settings_default_payment_terms_check
  check (default_payment_terms in ('on_invoice', 'days_3', 'days_7', 'twentieth'));

create or replace function public.invoice_due_date(p_issued date, p_terms text)
returns date
language sql
immutable
as $function$
  select case coalesce(p_terms, 'twentieth')
    when 'on_invoice' then p_issued
    when 'days_3'     then p_issued + 3
    when 'days_7'     then p_issued + 7
    -- The 20th of the NEXT month: 15 Aug -> 20 Sep, and 31 Aug -> 20 Sep too.
    when 'twentieth'  then (date_trunc('month', p_issued::timestamp) + interval '1 month' + interval '19 days')::date
    else p_issued
  end;
$function$;

-- 5. Line items for invoices that do not come from a job card. Job invoices
--    keep reading from job_line_items exactly as they do now; this table is
--    only for the rental and hire streams.
create table if not exists public.invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity    numeric not null default 1 check (quantity > 0),
  unit_price  numeric not null check (unit_price >= 0),
  amount      numeric not null check (amount >= 0),
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists invoice_line_items_invoice_idx
  on public.invoice_line_items (invoice_id);

alter table public.invoice_line_items enable row level security;

-- Same shape as credit_notes: staff can read and add, only an owner can change
-- or remove a line after the fact.
drop policy if exists ili_select on public.invoice_line_items;
create policy ili_select on public.invoice_line_items
  for select using (is_approved_staff());

drop policy if exists ili_insert on public.invoice_line_items;
create policy ili_insert on public.invoice_line_items
  for insert with check (is_approved_staff());

drop policy if exists ili_update on public.invoice_line_items;
create policy ili_update on public.invoice_line_items
  for update using (is_owner()) with check (is_owner());

drop policy if exists ili_delete on public.invoice_line_items;
create policy ili_delete on public.invoice_line_items
  for delete using (is_owner());

revoke all on public.invoice_line_items from anon;
grant select, insert, update, delete on public.invoice_line_items to authenticated;
