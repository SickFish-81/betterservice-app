-- Craig needs to fix an invoice that is WAITING FOR APPROVAL - the rent ones in
-- particular, where a wrong rate or a wrong set of dates is the usual fault.
--
-- Ben, 19 Oct 2026: "an edit will have to regenerate a pdf. because nothing is
-- sent without approval it makes it risk free."
--
-- The PDF half of that is true and handled below. The part that was NOT obvious:
--
--   AN INVOICE AWAITING APPROVAL IS ALREADY IN THE GENERAL LEDGER.
--
-- finalised_at is stamped the day the invoice is created, and
-- trg_ledger_invoice_finalise posts a journal entry off that - debit 110
-- receivables, credit 430 rent (or 400/410 labour and parts), credit 200 GST.
-- So by the time anyone looks at the approval screen the money is recognised.
-- That is what lock_invoice_money() was protecting, and it is why it says
-- "raise a credit note" rather than letting the figure move.
--
-- The tidy-looking alternative - don't finalise until it is sent - was tried on
-- paper and abandoned. EIGHT of the nine invoices currently awaiting approval
-- have ALREADY BEEN PAID. An invoice that has been paid but is missing from the
-- ledger is a worse problem than the one being solved. The approval gate is
-- about EMAILING, not about issuing.
--
-- So an edit is allowed, and the ledger is corrected honestly: the live journal
-- entry is REVERSED and a fresh one posted. The trail stays visible, which is
-- what an accountant would want to see anyway.
--
-- WHAT "ADJUSTABLE" MEANS, IN ONE PLACE
--
-- sent = false, no payment recorded, not already credited. Everything below
-- asks invoice_adjustable() rather than re-deriving that rule, because the
-- recurring fault in this app is two pieces of code that should agree and
-- eventually don't.
--
--
-- A TOOLING NOTE, PAID FOR TWICE
--
-- There is no DROP TRIGGER in this file, deliberately. The Supabase MCP tool
-- HANGS on any statement whose verb is DROP - `drop function` was known to do
-- it, and `drop trigger if exists` does too, even for a trigger that does not
-- exist, and even with no lock held on the table by anyone. Two 180-second
-- timeouts to establish that. `alter table ... drop constraint` is fine, which
-- is why 0083 worked. Postgres 17 has `create or replace trigger`, so nothing
-- needs dropping anyway.

-- A PAID invoice is NOT adjustable even while unsent. That is deliberate: money
-- has changed hands against a figure, and changing it afterwards is a credit
-- note, not an edit.

-- 1. The one definition.
create or replace function public.invoice_adjustable(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from invoices i
     where i.id = p_invoice
       and i.sent is not true
       and coalesce(i.status, '') <> 'Credited'
       and not exists (select 1 from payments p where p.invoice_id = i.id)
  );
$$;

comment on function public.invoice_adjustable(uuid) is
  'True while an invoice may still be changed: not sent, not paid, not credited. The single source of that rule.';

-- 2. The money lock lets an adjustable invoice move. Nothing else changes - the
--    message for an issued invoice is word for word what it was.
create or replace function public.lock_invoice_money()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.finalised_at is null then
    return new;
  end if;
  if new.subtotal is distinct from old.subtotal
     or new.gst   is distinct from old.gst
     or new.total is distinct from old.total then
    if public.invoice_adjustable(old.id) then
      return new;
    end if;
    raise exception 'Invoice #% has been issued — its totals are fixed. Raise a credit note to change it.',
      coalesce(old.invoice_number::text, '?');
  end if;
  return new;
end;
$$;

-- 3. The same relaxation on job lines.
--
--    This also fixes something nobody had noticed: the credit LINE added on
--    19 Oct (migration 0083) could only ever be used BEFORE the invoice was
--    generated, because this trigger locks job_line_items the moment a
--    finalised invoice exists - and invoices finalise on creation. Craig
--    putting a credit on an invoice he had just raised would have been told
--    "labour & parts are locked".
create or replace function public.enforce_job_line_items_not_invoiced()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job uuid := coalesce(new.job_card_id, old.job_card_id);
begin
  if exists (select 1 from invoices
              where job_card_id = v_job
                and finalised_at is not null
                and not public.invoice_adjustable(id)) then
    raise exception 'That invoice has been issued — labour & parts are locked. Raise a credit note to change it.';
  end if;
  return coalesce(new, old);
end;
$$;

-- 4. invoice_line_items.amount is a PLAIN column, not generated like
--    job_line_items.amount is. All 20 existing rows happen to agree with
--    quantity * unit_price; this makes that true by construction rather than by
--    luck, so an edit cannot leave a price and an amount disagreeing.
create or replace function public.set_invoice_line_amount()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.unit_price is not null then
    new.amount := round(coalesce(new.quantity, 1) * new.unit_price, 2);
  end if;
  return new;
end;
$$;

create or replace trigger trg_invoice_line_amount
  before insert or update on public.invoice_line_items
  for each row execute function public.set_invoice_line_amount();

-- 5. Rentals had NO total-resync trigger at all. Job cards have had
--    resync_draft_invoice_totals() since the beginning; the rental side was
--    doing its arithmetic once, in generate_rental_invoice(), and never again.
--    Same rule, confirmed against the live rows: subtotal = sum of lines,
--    GST = subtotal * 0.15, total = the two added.
--
--    It RAISES rather than skipping quietly when the invoice is past changing.
--    A silent skip would let lines and totals drift apart with nothing to show
--    it, which is the exact class of fault this app keeps producing.
create or replace function public.resync_invoice_line_totals()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv uuid := coalesce(new.invoice_id, old.invoice_id);
  v_sub numeric;
  v_gst numeric;
begin
  if not public.invoice_adjustable(v_inv) then
    raise exception 'Invoice #% has been sent or paid — its lines are fixed. Raise a credit note to change it.',
      coalesce((select invoice_number::text from invoices where id = v_inv), '?');
  end if;

  select coalesce(round(sum(amount), 2), 0) into v_sub
    from invoice_line_items where invoice_id = v_inv;

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
   where id = v_inv;

  return coalesce(new, old);
end;
$$;

create or replace trigger trg_resync_invoice_line_totals
  after insert or delete or update on public.invoice_line_items
  for each row execute function public.resync_invoice_line_totals();

-- 6. Job-card resync used to stop at "finalised_at is null", which is true of no
--    invoice in this database - they all finalise on creation. Widened to the
--    adjustable ones, which is what it was reaching for.
create or replace function public.resync_draft_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
     and (finalised_at is null or public.invoice_adjustable(id));

  return coalesce(new, old);
end;
$$;

-- 7. The ledger. One copy of the posting logic, called from two places.
--
--    "Live" entry means one that has not been reversed - the same test
--    ledger_on_invoice_delete() already uses. The old insert trigger asked
--    only whether an entry existed, which would have made a repost impossible
--    after a reversal.
create or replace function public.ledger_post_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  inv      invoices;
  v_lab numeric; v_par numeric; v_base numeric;
  v_clab numeric := 0; v_cpar numeric := 0; v_coth numeric;
  v_lines jsonb; v_no text; v_income text;
begin
  select * into inv from invoices where id = p_invoice;
  if not found then return null; end if;

  if exists (select 1 from journal_entries je
              where je.source_type = 'invoice' and je.source_id = inv.id
                and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)) then
    return null;
  end if;

  -- post_entry() refuses an entry with no value, and an invoice adjusted down to
  -- nothing is a real thing to do. The reversal stands on its own.
  if round(coalesce(inv.total, 0), 2) = 0 then return null; end if;

  v_no := 'Invoice #' || lpad(inv.invoice_number::text, 5, '0');

  -- Rent and hireage have no job lines; the whole subtotal is one kind of income.
  if inv.kind in ('rental', 'hire') then
    v_income := case inv.kind when 'rental' then '430' else '440' end;
    v_lines := jsonb_build_array(jsonb_build_object('account_code','110','debit', inv.total, 'memo', v_no));
    if coalesce(inv.subtotal,0) <> 0 then
      v_lines := v_lines || jsonb_build_object('account_code', v_income, 'credit', inv.subtotal);
    end if;
    if coalesce(inv.gst,0) > 0 then
      v_lines := v_lines || jsonb_build_object('account_code','200','credit', inv.gst);
    end if;
    return post_entry(coalesce(inv.issued_date, current_date), v_no, 'invoice', inv.id, v_lines);
  end if;

  select coalesce(sum(case when kind='labour' then amount else 0 end),0),
         coalesce(sum(case when kind='part'   then amount else 0 end),0)
    into v_lab, v_par
    from job_line_items where job_card_id = inv.job_card_id;
  v_base := v_lab + v_par;
  v_coth := coalesce(inv.subtotal,0);
  if v_base > 0 then
    v_clab := round(coalesce(inv.subtotal,0) * v_lab / v_base, 2);
    v_cpar := round(coalesce(inv.subtotal,0) * v_par / v_base, 2);
    v_coth := round(coalesce(inv.subtotal,0) - v_clab - v_cpar, 2);
  end if;

  v_lines := jsonb_build_array(jsonb_build_object('account_code','110','debit', inv.total, 'memo', v_no));
  if v_clab > 0 then v_lines := v_lines || jsonb_build_object('account_code','400','credit', v_clab); end if;
  if v_cpar > 0 then v_lines := v_lines || jsonb_build_object('account_code','410','credit', v_cpar); end if;
  if v_coth <> 0 then v_lines := v_lines || jsonb_build_object('account_code','420','credit', v_coth); end if;
  if coalesce(inv.gst,0) > 0 then v_lines := v_lines || jsonb_build_object('account_code','200','credit', inv.gst); end if;

  return post_entry(coalesce(inv.issued_date, current_date), v_no, 'invoice', inv.id, v_lines);
end;
$$;

create or replace function public.ledger_on_invoice_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.ledger_post_invoice(NEW.id);
  return NEW;
end;
$$;

-- Reverse the live entry and post a fresh one at the corrected figures.
create or replace function public.ledger_on_invoice_adjust()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_e record;
begin
  if new.subtotal     is not distinct from old.subtotal
     and new.gst      is not distinct from old.gst
     and new.total    is not distinct from old.total
     and new.issued_date is not distinct from old.issued_date then
    return new;
  end if;
  if not public.invoice_adjustable(new.id) then
    return new;
  end if;

  for v_e in
    select je.id from journal_entries je
     where je.source_type = 'invoice' and je.source_id = new.id
       and not exists (select 1 from journal_entries r where r.reverses_entry_id = je.id)
  loop
    perform reverse_entry(v_e.id, null,
      'Adjusted before sending: invoice #' || coalesce(new.invoice_number::text, '?'));
  end loop;

  perform public.ledger_post_invoice(new.id);
  return new;
end;
$$;

create or replace trigger trg_ledger_invoice_adjust
  after update of subtotal, gst, total, issued_date on public.invoices
  for each row
  when (new.finalised_at is not null and new.sent is not true)
  execute function public.ledger_on_invoice_adjust();

-- 8. A FILED PDF CAN NEVER OUTLIVE THE FIGURES IT SHOWS.
--
--    send-rental-invoice emails the PDF that was filed earlier, on purpose, so
--    that what the tenant receives is what was approved on screen. The flip
--    side is that an edited invoice with its old PDF still attached would email
--    the old numbers. Rather than trusting the UI to remember, the database
--    drops the filed PDF whenever an unsent invoice's money or dates move.
--
--    Failure then degrades the right way: send-rental-invoice refuses outright
--    with no PDF, and generate-rental-invoices re-files any missing one on its
--    next nightly run. The worst case is "can't send yet", never "sent the
--    wrong figures".
--
--    The pdf_url guard at the end lets the rebuild write a new path in the same
--    breath without clearing it again.
create or replace function public.clear_pdf_on_adjust()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.sent is not true
     and new.pdf_url is not distinct from old.pdf_url
     and (new.subtotal     is distinct from old.subtotal
          or new.gst          is distinct from old.gst
          or new.total        is distinct from old.total
          or new.issued_date  is distinct from old.issued_date
          or new.due_date     is distinct from old.due_date
          or new.period_start is distinct from old.period_start) then
    new.pdf_url := null;
  end if;
  return new;
end;
$$;

create or replace trigger trg_invoice_pdf_stale
  before update on public.invoices
  for each row execute function public.clear_pdf_on_adjust();
