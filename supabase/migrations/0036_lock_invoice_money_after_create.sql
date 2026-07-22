-- 0036_lock_invoice_money_after_create.sql
-- Money integrity (defense in depth): invoice totals are set once by
-- generate_invoice() and must never change afterward. Legitimate post-create
-- updates only touch sent/sent_by/sent_at/pdf_url and status/paid_date, so a
-- guard on the money columns won't interfere with them.
-- Idempotent: safe to re-run.
create or replace function public.lock_invoice_money()
returns trigger
language plpgsql
as $$
begin
  if new.subtotal is distinct from old.subtotal
     or new.gst   is distinct from old.gst
     or new.total is distinct from old.total then
    raise exception 'Invoice totals are fixed at creation — discard and regenerate the invoice to change them.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_invoice_money on public.invoices;
create trigger trg_lock_invoice_money
  before update on public.invoices
  for each row execute function public.lock_invoice_money();
