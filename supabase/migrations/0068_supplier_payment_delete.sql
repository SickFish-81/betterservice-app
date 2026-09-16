-- ============================================================================
-- Betterservice ATV — record the supplier-payment delete trigger (16 Sep 2026)
--
-- THIS IS ALREADY APPLIED. It is written down here because it was not.
--
-- Found while checking whether the app could safely offer "remove this payment"
-- on the Bills page: production already had ledger_on_supplier_payment_delete()
-- and its trigger, but no migration in this repo created them. That is the third
-- drift of this kind (parts.cost_price, email_log), so it is being closed the
-- same way — the file records exactly what is live, and re-running it is a no-op.
--
-- What it does, mirroring 0030 on the customer side:
--   1. Reverses the supplier_payment journal entry, unless it has already been
--      reversed, so a re-run cannot double-reverse.
--   2. Recalculates what is left against the bill and puts its status and
--      paid_date back when the remaining payments no longer cover the total.
--      Guarded by an exists() check because the expense may itself be mid-delete,
--      with its payments cascading out from under this trigger.
--
-- Runs AFTER DELETE, so the deleted row is already out of the sum.
--
-- Known quirk, deliberately left as-is rather than "fixed" in a live database:
-- a bill whose total is 0 reads as Paid once its last payment is removed, since
-- 0 >= 0. Such a bill never appears on the Bills page (which lists Unpaid bills
-- with a balance owing), so nothing depends on it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.ledger_on_supplier_payment_delete()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_e record; v_total numeric; v_paid numeric;
begin
  for v_e in
    select je.id
    from journal_entries je
    where je.source_type = 'supplier_payment' and je.source_id = OLD.id
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)
  loop
    perform reverse_entry(v_e.id, null, 'Void: supplier payment reversed');
  end loop;

  -- Keep the expense's paid status in step, mirroring the insert trigger.
  -- Guarded because the expense may itself be mid-delete (cascade).
  if exists (select 1 from expenses where id = OLD.expense_id) then
    select total into v_total from expenses where id = OLD.expense_id;
    select coalesce(sum(amount), 0) into v_paid
      from supplier_payments where expense_id = OLD.expense_id;
    update expenses
       set status    = case when v_paid >= coalesce(v_total, 0) then 'Paid' else 'Unpaid' end,
           paid_date = case when v_paid >= coalesce(v_total, 0) then paid_date else null end
     where id = OLD.expense_id;
  end if;

  return OLD;
end $function$;

drop trigger if exists trg_ledger_on_supplier_payment_delete on public.supplier_payments;
create trigger trg_ledger_on_supplier_payment_delete
  after delete on public.supplier_payments
  for each row execute function public.ledger_on_supplier_payment_delete();
