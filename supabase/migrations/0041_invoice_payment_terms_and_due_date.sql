-- ============================================================================
-- Betterservice ATV — payment terms + due date on invoices (27 Aug 2026)
--
-- Three terms, chosen before an invoice is sent:
--   'on_invoice'  — due on receipt
--   'days_7'      — due within 7 days
--   'twentieth'   — due the 20th of the month following (standard NZ trade terms)
--
-- The DATE IS DERIVED, never typed. A trigger recomputes due_date from
-- issued_date + payment_terms on every insert and update, so the date printed on
-- the customer's PDF and the date used by the overdue reports are the same value
-- from the same rule. If it were entered by hand — or computed in the browser —
-- they would eventually disagree, and the disagreement would show up as chasing
-- someone for money that isn't due yet.
-- ============================================================================

alter table public.invoices
  add column if not exists payment_terms text
    check (payment_terms in ('on_invoice', 'days_7', 'twentieth')),
  add column if not exists due_date date;

alter table public.shop_settings
  add column if not exists default_payment_terms text
    check (default_payment_terms in ('on_invoice', 'days_7', 'twentieth'));

update public.shop_settings
  set default_payment_terms = 'twentieth'
  where default_payment_terms is null;

create or replace function public.invoice_due_date(p_issued date, p_terms text)
returns date
language sql
immutable
as $function$
  select case coalesce(p_terms, 'twentieth')
    when 'on_invoice' then p_issued
    when 'days_7'     then p_issued + 7
    -- The 20th of the NEXT month: 15 Aug -> 20 Sep, and 31 Aug -> 20 Sep too.
    when 'twentieth'  then (date_trunc('month', p_issued::timestamp) + interval '1 month' + interval '19 days')::date
    else p_issued
  end;
$function$;

create or replace function public.set_invoice_due_date()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.payment_terms := coalesce(
    new.payment_terms,
    (select default_payment_terms from public.shop_settings limit 1),
    'twentieth'
  );
  new.due_date := public.invoice_due_date(coalesce(new.issued_date, current_date), new.payment_terms);
  return new;
end;
$function$;

drop trigger if exists trg_invoice_due_date on public.invoices;
create trigger trg_invoice_due_date
  before insert or update of issued_date, payment_terms on public.invoices
  for each row execute function public.set_invoice_due_date();

update public.invoices
  set payment_terms = coalesce(payment_terms, (select default_payment_terms from public.shop_settings limit 1), 'twentieth')
  where payment_terms is null or due_date is null;

revoke execute on function public.invoice_due_date(date, text) from public, anon;
grant  execute on function public.invoice_due_date(date, text) to authenticated;
