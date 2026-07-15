-- ============================================================================
-- Betterservice Tepuke — supplier payments / pay bills (Phase 3c)
-- Built 14 July 2026. Runs after 0003 (expenses/ledger) + 0008 (purchase orders).
-- Settles on-account bills (from Expenses + received POs) that sit in Accounts
-- Payable. A payment posts DR 210 Accounts Payable / CR 100 Bank and flips the
-- bill's status to Paid once fully settled. Mirrors the customer-side payments.
-- ============================================================================

create table if not exists public.supplier_payments (
  id         uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  amount     numeric not null check (amount > 0) check (amount = round(amount, 2)),
  paid_date  date not null default ((now() at time zone 'Pacific/Auckland'))::date,
  method     text,
  created_by uuid references public.staff(id),
  created_at timestamptz default now()
);
create index if not exists supplier_payments_expense_idx on public.supplier_payments (expense_id);

create or replace function public.ledger_on_supplier_payment_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_no text; v_total numeric; v_paid numeric;
begin
  if exists (select 1 from journal_entries where source_type = 'supplier_payment' and source_id = NEW.id) then
    return NEW;
  end if;
  select 'Supplier payment' || coalesce(' — ' || e.supplier, '') || coalesce(' (' || e.description || ')', ''), e.total
    into v_no, v_total
    from expenses e where e.id = NEW.expense_id;
  perform post_entry(coalesce(NEW.paid_date, current_date), v_no, 'supplier_payment', NEW.id,
    jsonb_build_array(
      jsonb_build_object('account_code', '210', 'debit',  NEW.amount),
      jsonb_build_object('account_code', '100', 'credit', NEW.amount)
    ));
  select coalesce(sum(amount), 0) into v_paid from supplier_payments where expense_id = NEW.expense_id;
  update expenses
     set status = case when v_paid >= coalesce(v_total, 0) then 'Paid' else 'Unpaid' end,
         paid_date = case when v_paid >= coalesce(v_total, 0) then NEW.paid_date else null end
   where id = NEW.expense_id;
  return NEW;
end
$function$;

drop trigger if exists trg_ledger_supplier_payment_insert on public.supplier_payments;
create trigger trg_ledger_supplier_payment_insert after insert on public.supplier_payments
  for each row execute function ledger_on_supplier_payment_insert();

alter table public.supplier_payments enable row level security;
drop policy if exists sup_pay_select on public.supplier_payments;
create policy sup_pay_select on public.supplier_payments for select to authenticated using (is_approved_staff());
drop policy if exists sup_pay_insert on public.supplier_payments;
create policy sup_pay_insert on public.supplier_payments for insert to authenticated with check (is_approved_staff());
drop policy if exists sup_pay_delete on public.supplier_payments;
create policy sup_pay_delete on public.supplier_payments for delete to authenticated using (is_owner());
