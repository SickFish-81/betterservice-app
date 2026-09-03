-- Credit notes: credit back what was billed, and stop reading as money owed.
--
-- Invoice #01008 (Kinsey, Unit 3, the weekly rate in the monthly box) was
-- credited by CN-00001. The money cancelled out, but in the wrong place, and
-- the invoice still reads "Unpaid".
--
-- 1. WHERE THE CREDIT LANDS
--
-- ledger_on_credit_note_insert() worked out which revenue account to credit by
-- looking at job_line_items — labour and parts. That is the whole world of a
-- job-card invoice, and none of a rental one, which has no job card at all. So
-- for #01008 the labour share was 0, the parts share was 0, and the remainder
-- fell to 420 Sales — Other. The invoice had credited 430 Sales — Rentals.
-- Net revenue was right; the split was not. Rentals reads $100 higher than it
-- earned and "Other" carries a $100 debit that means nothing.
--
-- Rather than teach it about rental and hireage — and then about whatever comes
-- next — it now reads the ORIGINAL invoice's own journal entry and credits back
-- the same accounts in the same proportions. A credit note is a reversal, so
-- the accounts it touches should be the ones being reversed. Any invoice kind,
-- including ones not invented yet, is handled without further edits.
--
-- 2. WHAT THE INVOICE READS AS
--
-- A fully credited invoice is settled: nothing is owed, and it should not sit
-- in the unpaid list or count in the "invoices unpaid" banner. It now shows
-- Credited, and reverts if the credit note is ever deleted.


-- How much has been credited against an invoice.
create or replace function public.invoice_credited_total(p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(total), 0) from credit_notes where invoice_id = p_invoice_id;
$$;


create or replace function public.ledger_on_credit_note_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_no      text;
  v_lines   jsonb;
  v_rev     numeric;      -- revenue credited by the original invoice
  v_run     numeric := 0; -- allocated so far, so the last line absorbs rounding
  v_amt     numeric;
  v_n       int;
  v_i       int;
  v_codes   text[];
  v_amounts numeric[];
begin
  if exists (select 1 from journal_entries where source_type='credit_note' and source_id = NEW.id) then
    return NEW;
  end if;
  v_no := 'Credit note #' || lpad(NEW.credit_note_number::text, 5, '0');

  -- The revenue lines of the invoice being credited, straight from its entry.
  -- Read into an array rather than a temp table: a trigger can fire more than
  -- once in a transaction, and a temp table would collide with itself.
  select coalesce(array_agg(t.code order by t.code), '{}'),
         coalesce(array_agg(t.amount order by t.code), '{}'),
         coalesce(sum(t.amount), 0)
    into v_codes, v_amounts, v_rev
  from (
    select a.code, jl.credit as amount
    from journal_entries je
    join journal_lines jl on jl.entry_id = je.id
    join accounts a on a.id = jl.account_id
    where je.source_type = 'invoice'
      and je.source_id = NEW.invoice_id
      and a.code like '4%'
      and coalesce(jl.credit, 0) > 0
  ) t;

  v_n := coalesce(array_length(v_codes, 1), 0);

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','110','credit', NEW.total, 'memo', v_no)
  );

  if v_rev > 0 then
    for v_i in 1 .. v_n loop
      if v_i = v_n then
        v_amt := round(coalesce(NEW.subtotal,0) - v_run, 2);   -- last line takes the rounding
      else
        v_amt := round(coalesce(NEW.subtotal,0) * (v_amounts[v_i] / v_rev), 2);
        v_run := v_run + v_amt;
      end if;
      if v_amt <> 0 then
        v_lines := v_lines || jsonb_build_object('account_code', v_codes[v_i], 'debit', v_amt);
      end if;
    end loop;
  elsif coalesce(NEW.subtotal,0) <> 0 then
    -- No invoice entry to read (a free-standing credit note, or one against an
    -- invoice that has since gone). Sales — Other is the honest place for it.
    v_lines := v_lines || jsonb_build_object('account_code','420','debit', NEW.subtotal);
  end if;

  if coalesce(NEW.gst,0) > 0 then
    v_lines := v_lines || jsonb_build_object('account_code','200','debit', NEW.gst);
  end if;

  perform post_entry(coalesce(NEW.created_at::date, current_date), v_no, 'credit_note', NEW.id, v_lines);
  return NEW;
end $function$;


-- A fully credited invoice is settled, and should say so.
create or replace function public.sync_invoice_credit_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv uuid := coalesce(NEW.invoice_id, OLD.invoice_id);
  v_i   invoices;
  v_cr  numeric;
  v_paid numeric;
begin
  if v_inv is null then return coalesce(NEW, OLD); end if;
  select * into v_i from invoices where id = v_inv;
  if not found then return coalesce(NEW, OLD); end if;

  v_cr   := invoice_credited_total(v_inv);
  select coalesce(sum(amount),0) into v_paid from payments where invoice_id = v_inv;

  if v_cr >= coalesce(v_i.total,0) and coalesce(v_i.total,0) > 0 and v_paid = 0 then
    update invoices set status = 'Credited' where id = v_inv and coalesce(status,'') <> 'Credited';
  elsif v_i.status = 'Credited' then
    -- The credit was removed; put it back where it was.
    update invoices
       set status = case when v_paid >= coalesce(v_i.total,0) then 'Paid' else 'Unpaid' end
     where id = v_inv;
  end if;
  return coalesce(NEW, OLD);
end $function$;

drop trigger if exists trg_credit_note_status on public.credit_notes;
create trigger trg_credit_note_status
  after insert or delete on public.credit_notes
  for each row execute function public.sync_invoice_credit_status();


-- The banner counted anything sent and not Paid. Credited is settled too.
create or replace function public.attention_summary()
returns table(low_stock integer, service_due integer, bills_count integer, bills_total numeric, invoices_unpaid integer, bookings_new integer, jobs_ready integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not is_approved_staff() then return; end if;
  return query select
    (select count(*) from parts where coalesce(min_stock,0) > 0 and qty_on_hand <= min_stock)::int,
    (select count(*) from machines m join customers c on c.id = m.customer_id
       where m.last_service_date is not null and coalesce(c.no_reminders, false) = false
         and age(now(), m.last_service_date) >= interval '12 months'
         and age(now(), m.last_service_date) <= interval '18 months')::int,
    (select count(*) from expenses where status = 'Unpaid' and paid_on_account)::int,
    (select coalesce(sum(total), 0) from expenses where status = 'Unpaid' and paid_on_account)::numeric,
    (select count(*) from invoices
       where sent = true and coalesce(status, '') not in ('Paid', 'Credited'))::int,
    (select count(*) from booking_requests where status = 'new')::int,
    (select count(*) from job_cards where status = 'Ready')::int;
end
$function$;


-- Catch up anything already fully credited (that is #01008 today).
update invoices i
   set status = 'Credited'
 where coalesce(i.status,'') not in ('Paid','Credited')
   and coalesce(i.total,0) > 0
   and public.invoice_credited_total(i.id) >= i.total
   and not exists (select 1 from payments p where p.invoice_id = i.id);


-- Move CN-00001's $100 from Sales — Other to Sales — Rentals, where invoice
-- #01008 credited it. Posted as its own dated correction rather than by editing
-- the original entry: the books show what was posted and what fixed it.
do $$
declare v_entry uuid; v_other uuid; v_rent uuid;
begin
  if exists (
    select 1 from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    join accounts a on a.id = jl.account_id
    where je.source_type = 'credit_note' and a.code = '420' and jl.debit = 100
  ) and not exists (
    select 1 from journal_entries where memo = 'Correction: CN-00001 credited to Rentals, not Other'
  ) then
    select id into v_other from accounts where code = '420';
    select id into v_rent  from accounts where code = '430';
    insert into journal_entries (entry_date, memo, source_type)
      values (current_date, 'Correction: CN-00001 credited to Rentals, not Other', 'manual')
      returning id into v_entry;
    insert into journal_lines (entry_id, account_id, debit, credit, memo) values
      (v_entry, v_rent,  100, 0, 'Credit note #00001 belongs against rental income'),
      (v_entry, v_other, 0, 100, 'Reverses the mis-posted Sales — Other debit');
  end if;
end $$;
