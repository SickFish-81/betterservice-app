-- Craig wants to put a credited line straight on an invoice - money given back
-- as its own line, rather than a separate credit note.
--
-- Credit notes are not going away: once an invoice is ISSUED its totals are
-- fixed by lock_invoice_money(), and that is correct - a tax invoice in a
-- customer's hand cannot quietly change. This is for DRAFTS, where the
-- discount is part of the bill from the start.
--
-- WHAT WAS ACTUALLY IN THE WAY
--
-- Workshop invoices already worked. job_line_items.amount is generated as
-- (quantity * unit_price) and resync_draft_invoice_totals() just sums, so a
-- negative flowed through correctly - proved at $230 + $28 - $50 = $208,
-- GST $31.20, total $239.20. The only blocker was min="0" on the price box.
--
-- Rental and hire invoices were blocked properly, by three check constraints
-- on invoice_line_items.
--
-- WHY A THIRD KIND RATHER THAN A NEGATIVE 'labour' LINE
--
-- A credit is not labour and it is not a part. Recording it as labour would
-- understate labour revenue by exactly the amount given away, and leave no way
-- to see what discounting costs. Only two places in the app branch on kind, so
-- a third one is cheap. One word, one meaning.
--
-- Applied to production 19 Oct 2026. No negative lines existed anywhere
-- beforehand (302 job lines, 20 invoice lines, 68 invoices all checked), so
-- the new guards cannot contradict history.

-- 1. The new kind.
alter table public.job_line_items drop constraint if exists job_line_items_kind_check;
alter table public.job_line_items
  add constraint job_line_items_kind_check
  check (kind = any (array['labour'::text, 'part'::text, 'credit'::text]));

-- 2. Signs have to match intent, or a mistyped credit silently becomes a charge.
alter table public.job_line_items drop constraint if exists job_line_items_sign_matches_kind;
alter table public.job_line_items
  add constraint job_line_items_sign_matches_kind
  check (
    case
      when kind = 'credit' then coalesce(unit_price, 0) <= 0
      else coalesce(unit_price, 0) >= 0
    end
  );

-- 3. Rental and hire invoices: let a line go negative. Quantity stays positive -
--    a credit is one line at a negative price, never a negative quantity, so the
--    arithmetic has exactly one way to express itself.
alter table public.invoice_line_items drop constraint if exists invoice_line_items_amount_check;
alter table public.invoice_line_items drop constraint if exists invoice_line_items_unit_price_check;

-- 4. An invoice may never total below zero. If the credits outweigh the
--    charges, the document is a credit note and should be raised as one.
alter table public.invoices drop constraint if exists invoices_not_negative;
alter table public.invoices
  add constraint invoices_not_negative
  check (subtotal >= 0 and total >= 0);

-- 5. Say it in words. Without this the constraint above reports a raw check
--    violation, which means nothing to Craig standing at the counter.
create or replace function public.resync_draft_invoice_totals()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job uuid := coalesce(new.job_card_id, old.job_card_id);
  v_sub numeric;
  v_gst numeric;
begin
  select coalesce(round(sum(amount), 2), 0) into v_sub
    from job_line_items where job_card_id = v_job;

  -- An invoice that owes the customer money is a credit note, not an invoice.
  if v_sub < 0 then
    raise exception
      'That credit is bigger than the invoice: the total would be %. Reduce the credit, or raise a credit note instead.',
      to_char(v_sub, 'FM$999G999D00');
  end if;

  v_gst := round(v_sub * 0.15, 2);

  update invoices
     set subtotal = v_sub,
         gst      = v_gst,
         total    = v_sub + v_gst
   where job_card_id = v_job
     and finalised_at is null;

  return coalesce(new, old);
end;
$function$;
