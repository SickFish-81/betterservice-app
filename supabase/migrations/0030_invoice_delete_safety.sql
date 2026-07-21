-- ============================================================================
-- Betterservice Te Puke — invoice/payment deletion safety (21 July 2026)
-- CODE_REVIEW.md High-Priority #6:
--   (a) Only a can-send owner may delete a SENT invoice. Draft (unsent) invoices
--       stay deletable by any staff, so discarding a draft still works.
--   (b) Deleting an invoice or a payment now REVERSES its ledger entries (using
--       the existing reverse_entry()), instead of leaving orphaned journal
--       entries pointing at nothing. The reversal shows in the books as an audit
--       trail ("Void: …"), which is the correct accounting way to undo a posting.
--
-- Note: payments cascade-delete with their invoice, so the payment trigger also
-- covers the "delete a paid invoice" case. credit_notes are ON DELETE NO ACTION,
-- so an invoice with credit notes still can't be deleted (existing safeguard).
-- Idempotent: create-or-replace + drop-if-exists.
-- ============================================================================

-- (a) Tighten who can delete a sent invoice (mirrors the invoices_update rule).
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to authenticated
  using (is_approved_staff() and ((sent = false) or current_staff_can_send()));

-- (b) Reverse the ledger when an invoice is deleted.
create or replace function public.ledger_on_invoice_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_e record;
begin
  for v_e in
    select je.id
    from journal_entries je
    where je.source_type = 'invoice' and je.source_id = OLD.id
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)
  loop
    perform reverse_entry(v_e.id, null,
      'Void: invoice #' || coalesce(OLD.invoice_number::text, '?') || ' deleted');
  end loop;
  return OLD;
end $function$;

drop trigger if exists trg_ledger_on_invoice_delete on public.invoices;
create trigger trg_ledger_on_invoice_delete
  after delete on public.invoices
  for each row execute function public.ledger_on_invoice_delete();

-- (b) Reverse the ledger when a payment is deleted (also covers payments that
--     cascade-delete when their invoice is removed).
create or replace function public.ledger_on_payment_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_e record;
begin
  for v_e in
    select je.id
    from journal_entries je
    where je.source_type = 'payment' and je.source_id = OLD.id
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)
  loop
    perform reverse_entry(v_e.id, null, 'Void: payment reversed');
  end loop;
  return OLD;
end $function$;

drop trigger if exists trg_ledger_on_payment_delete on public.payments;
create trigger trg_ledger_on_payment_delete
  after delete on public.payments
  for each row execute function public.ledger_on_payment_delete();
