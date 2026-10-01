-- ============================================================================
-- Betterservice Te Puke — editable invoices: draft until issued (30 Sep 2026)
--
-- Craig asked to be able to edit an invoice before confirming and sending it.
-- Until now he couldn't: three locks made an invoice immutable the instant it
-- was created (0028 froze the job's labour & parts, 0036/0037 froze the money,
-- and the ledger posted on insert). His only recourse was Discard → edit → 
-- regenerate, and because invoice_number is a generated identity column that
-- BURNED A NUMBER every time, leaving gaps in the sequence. For a GST-registered
-- business that is the part that actually matters.
--
-- The new rule, one sentence: an invoice is a DRAFT until it is issued, and it
-- is issued the moment it reaches the customer — printed or emailed, whichever
-- happens first (Ben's decision, 30 Sep: a printed document in a customer's
-- hand is a tax invoice).
--
--   Draft    finalised_at IS NULL      no number, no ledger entry, fully editable
--   Issued   finalised_at IS NOT NULL  numbered, posted, frozen for good
--
-- A number is therefore only ever spent on a document that genuinely went out,
-- so the sequence stops developing gaps.
--
-- SCOPE: phase 1 is WORKSHOP invoices only. Rentals already have their own
-- review step (the Rentals → Approvals tab) and hireage is low volume, so both
-- finalise inline at generation and behave exactly as they do today. This keeps
-- the blast radius on the one path Craig complained about.
--
-- Idempotent: add-column-if-not-exists, create-or-replace, drop-if-exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The draft marker.
--    Explicit column rather than inferring draft-ness from a null invoice_number
--    — the intent should be readable in the row, not deduced.
-- ----------------------------------------------------------------------------
alter table public.invoices add column if not exists finalised_at timestamptz;
alter table public.invoices add column if not exists finalised_by uuid
  references public.staff(id) on delete no action;

-- ----------------------------------------------------------------------------
-- 2. BACKFILL FIRST — before anything downstream treats null as "draft".
--    Every invoice that already exists was issued the day it was made. Skip this
--    and Craig's entire back catalogue silently becomes editable drafts and
--    drops out of his debtor book.
--    (Safe against the existing triggers: no totals change, and issued_date and
--    payment_terms are untouched, so neither the money lock nor the due-date
--    trigger has anything to object to.)
--
--    The `invoice_number is not null` guard below is what makes this safe to
--    RE-RUN. Without it a second run would sweep up any genuine draft sitting in
--    the table, stamp it finalised and — because the finalise trigger exists by
--    then — post it to the ledger with no number at all, giving a journal entry
--    memo of 'Invoice #' and nothing after it.
-- ----------------------------------------------------------------------------
update public.invoices
   set finalised_at = coalesce(sent_at, created_at, now())
 where finalised_at is null
   and invoice_number is not null;

-- ----------------------------------------------------------------------------
-- 3. A draft has no number.
--    Postgres will NOT let you drop NOT NULL on an identity column, so the
--    identity has to go first. Dropping it also drops its sequence, so the
--    high-water mark (1051 today) is read out beforehand and restored into a
--    plain sequence of the same name, owned by the same column. Numbering
--    therefore continues unbroken; only the mechanism underneath changes.
-- ----------------------------------------------------------------------------
do $mig$
declare v_last bigint;
begin
  if (select attidentity from pg_attribute
        where attrelid = 'public.invoices'::regclass and attname = 'invoice_number') <> '' then
    -- Remember where the identity sequence had got to; dropping the identity
    -- drops the sequence with it, and losing the high-water mark would re-issue
    -- numbers that are already on invoices Craig has sent.
    select last_value into v_last from public.invoices_invoice_number_seq;
    execute 'alter table public.invoices alter column invoice_number drop identity';
    execute 'create sequence public.invoices_invoice_number_seq as bigint';
    perform setval('public.invoices_invoice_number_seq',
                   greatest(v_last, coalesce((select max(invoice_number) from public.invoices), 1000)),
                   true);
    execute 'alter sequence public.invoices_invoice_number_seq owned by public.invoices.invoice_number';
  end if;
end
$mig$;

alter table public.invoices alter column invoice_number drop not null;

-- ----------------------------------------------------------------------------
-- 4. The uniqueness that migration 0066's comment already claims exists but
--    never did. Partial, so unnumbered drafts don't collide with each other.
-- ----------------------------------------------------------------------------
create unique index if not exists invoices_invoice_number_uniq
  on public.invoices (invoice_number) where invoice_number is not null;

-- ----------------------------------------------------------------------------
-- 5. Money lock — now bites only once the invoice has been issued.
--    Totals move freely while it is a draft; the moment it is issued they are
--    frozen for good, which is the guarantee 0036 was really after.
-- ----------------------------------------------------------------------------
create or replace function public.lock_invoice_money()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.finalised_at is null then
    return new;
  end if;
  if new.subtotal is distinct from old.subtotal
     or new.gst   is distinct from old.gst
     or new.total is distinct from old.total then
    raise exception 'Invoice #% has been issued — its totals are fixed. Raise a credit note to change it.',
      coalesce(old.invoice_number::text, '?');
  end if;
  return new;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 6. Labour & parts lock — likewise, only once issued. This is the single
--    change that gives Craig what he asked for.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_job_line_items_not_invoiced()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job uuid := coalesce(new.job_card_id, old.job_card_id);
begin
  if exists (select 1 from invoices
              where job_card_id = v_job and finalised_at is not null) then
    raise exception 'That invoice has been issued — labour & parts are locked. Raise a credit note to change it.';
  end if;
  return coalesce(new, old);
end;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Keep a draft's stored totals honest while Craig edits.
--    A workshop invoice carries no lines of its own — the job card is the
--    source of truth — so the invoice's subtotal/GST/total have to follow the
--    job's lines as they change, or the figures in the database drift away from
--    the figures on the PDF.
-- ----------------------------------------------------------------------------
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

drop trigger if exists trg_resync_draft_invoice_totals on public.job_line_items;
create trigger trg_resync_draft_invoice_totals
  after insert or update or delete on public.job_line_items
  for each row execute function public.resync_draft_invoice_totals();

-- ----------------------------------------------------------------------------
-- 8. The ledger posts on ISSUE, not on insert.
--    This isn't optional tidiness: ledger_on_invoice_insert() builds its memo
--    from lpad(invoice_number), and a draft has no number. More importantly, an
--    unissued invoice is not yet a receivable and has no business in the books.
--    The function body is unchanged and is already idempotent (it returns early
--    if a journal entry for this invoice exists), so re-issuing cannot double-post.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_ledger_invoice_insert on public.invoices;
drop trigger if exists trg_ledger_invoice_finalise on public.invoices;
create trigger trg_ledger_invoice_finalise
  after update of finalised_at on public.invoices
  for each row
  when (old.finalised_at is null and new.finalised_at is not null)
  execute function public.ledger_on_invoice_insert();

-- ----------------------------------------------------------------------------
-- 9. A machine hasn't been serviced until the invoice is real.
--    This trigger stamps machines.last_service_date, which drives the 12-month
--    service-due reminders. Left as it was, a draft that Craig later discards
--    would still have moved the machine's service date — and that wrong date
--    then suppresses a genuine reminder a year later.
-- ----------------------------------------------------------------------------
create or replace function public.stamp_machine_service_date()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.job_card_id is null then return new; end if;
  if new.finalised_at is null then return new; end if;

  update machines m
     set last_service_date = greatest(
           coalesce(m.last_service_date, new.issued_date),
           new.issued_date)
    from job_cards j
   where j.id = new.job_card_id
     and m.id = j.machine_id
     and new.issued_date is not null;

  return new;
end;
$function$;

drop trigger if exists trg_stamp_machine_service_date on public.invoices;
create trigger trg_stamp_machine_service_date
  after insert or update of issued_date, finalised_at on public.invoices
  for each row execute function public.stamp_machine_service_date();

-- ----------------------------------------------------------------------------
-- 10. Issue the invoice. This is the "confirm" half of confirm-and-send.
--     Idempotent on purpose: called twice it returns the row untouched rather
--     than posting to the ledger twice or burning a second number. The app calls
--     it before emailing AND before printing.
-- ----------------------------------------------------------------------------
create or replace function public.finalise_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv   public.invoices;
  v_sub   numeric;
  v_gst   numeric;
  v_staff uuid;
begin
  -- service_role is here for the nightly rental run, which has no signed-in
  -- staff member behind it. Leave it out and generate_rental_invoice() fails
  -- the moment it tries to issue.
  if not (is_approved_staff()
          or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'Not authorized';
  end if;

  -- Row lock: two people hitting Send at once must not both draw a number.
  select * into v_inv from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'No such invoice';
  end if;

  if v_inv.finalised_at is not null then
    return v_inv;
  end if;

  if v_inv.job_card_id is not null then
    -- Workshop: re-derive from the job card one last time, so what gets frozen
    -- is what the PDF will actually print.
    select coalesce(round(sum(amount), 2), 0) into v_sub
      from job_line_items where job_card_id = v_inv.job_card_id;
    if v_sub = 0 then
      raise exception 'Nothing to invoice — add labour or parts first.';
    end if;
    v_gst := round(v_sub * 0.15, 2);
  else
    -- Rent and hireage compute GST from a GST-INCLUSIVE rate (x * 3/23), not by
    -- adding 15% to a net figure. Recomputing them here could shift a cent, so
    -- their figures are left exactly as their generator set them — only checked.
    select coalesce(round(sum(amount), 2), 0) into v_sub
      from invoice_line_items where invoice_id = v_inv.id;
    if v_sub = 0 then
      raise exception 'This invoice has no lines.';
    end if;
    v_sub := v_inv.subtotal;
    v_gst := v_inv.gst;
  end if;

  select id into v_staff from staff where lower(email) = lower(auth.email());

  update invoices
     set subtotal       = v_sub,
         gst            = v_gst,
         total          = v_sub + v_gst,
         invoice_number = coalesce(invoice_number,
                            nextval('public.invoices_invoice_number_seq')),
         finalised_at   = now(),
         finalised_by   = v_staff
   where id = p_invoice_id
   returning * into v_inv;

  return v_inv;
end;
$function$;

revoke execute on function public.finalise_invoice(uuid) from public, anon;
grant  execute on function public.finalise_invoice(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 11. Workshop invoices are now born as drafts: no number, no ledger entry.
--     The explicit `null` for invoice_number matters — the column is a
--     `generated BY DEFAULT` identity, so omitting it would fill it in.
-- ----------------------------------------------------------------------------
create or replace function public.generate_invoice(p_job_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count    int;
  v_subtotal numeric;
  v_gst      numeric;
  v_total    numeric;
  v_inv      public.invoices;
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;
  if p_job_id is null then
    raise exception 'No job specified';
  end if;
  if exists (select 1 from invoices where job_card_id = p_job_id) then
    raise exception 'This job already has an invoice.';
  end if;

  select count(*), coalesce(round(sum(amount), 2), 0)
    into v_count, v_subtotal
  from job_line_items
  where job_card_id = p_job_id;

  if v_count = 0 then
    raise exception 'Nothing to invoice — add labour or parts first.';
  end if;

  v_gst   := round(v_subtotal * 0.15, 2);
  v_total := v_subtotal + v_gst;

  begin
    insert into invoices (invoice_number, job_card_id, subtotal, gst, total, status)
      values (null, p_job_id, v_subtotal, v_gst, v_total, 'Unpaid')
      returning * into v_inv;
  exception
    when unique_violation then
      raise exception 'This job already has an invoice.';
  end;

  update job_cards set status = 'Invoiced' where id = p_job_id;

  return v_inv;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 12. Hireage issues immediately — unchanged behaviour, phase 1 scope.
-- ----------------------------------------------------------------------------
create or replace function public.generate_hire_invoice(p_hire_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  h       hires;
  v_item  hire_items;
  v_total numeric;
  v_gst   numeric;
  v_sub   numeric;
  v_inv   invoices;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;

  select * into h from hires where id = p_hire_id;
  if not found then raise exception 'No such hire'; end if;
  if h.invoice_id is not null then raise exception 'That hire has already been invoiced.'; end if;

  select * into v_item from hire_items where id = h.item_id;

  v_total := case h.rate_type when 'half' then v_item.half_day_rate_incl_gst
                              else v_item.full_day_rate_incl_gst end;
  v_gst   := round(v_total * 3 / 23.0, 2);
  v_sub   := v_total - v_gst;

  insert into invoices (customer_id, kind, subtotal, gst, total, status, issued_date, payment_terms)
    values (h.customer_id, 'hire', v_sub, v_gst, v_total, 'Unpaid', h.hire_date, 'on_invoice')
    returning * into v_inv;

  insert into invoice_line_items (invoice_id, description, quantity, unit_price, amount)
    values (v_inv.id,
            v_item.name || ' hire — ' || case h.rate_type when 'half' then 'half day' else 'full day' end
              || ' — ' || to_char(h.hire_date, 'DD Mon YYYY'),
            1, v_sub, v_sub);

  update hires set invoice_id = v_inv.id where id = p_hire_id;

  -- Hireage has no separate review step, so it is issued the moment it is made,
  -- exactly as it behaved before drafts existed.
  v_inv := public.finalise_invoice(v_inv.id);

  return v_inv;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 13. Drafts are not money owed.
--     A draft defaults to status 'Unpaid', so without these two filters a
--     half-finished invoice would appear in a customer's statement and in the
--     debtor book, and would nag Craig from the unsent list. Nothing would
--     error — the numbers would simply be wrong.
--
--     Deliberately NOT changed, having checked each one:
--       accounting_overview()  reads the ledger only, and drafts don't post
--       attention_summary()    counts `sent = true`, which a draft never is
--       invoice_delivery       a delivery log; a draft reading "Not sent" is true
-- ----------------------------------------------------------------------------
create or replace view public.invoices_unsent as
  select i.id as invoice_id,
         i.invoice_number,
         i.kind,
         i.total,
         i.status,
         i.issued_date,
         coalesce(c.name, c2.name) as customer,
         coalesce(nullif(trim(both from c.email), ''), nullif(trim(both from c2.email), '')) as email,
         (now() at time zone 'Pacific/Auckland')::date - i.issued_date as days_waiting,
         case
           when coalesce(nullif(trim(both from c.email), ''), nullif(trim(both from c2.email), '')) is null
             then 'No email address on file'
           when i.kind = 'rental' then 'Waiting for approval'
           else 'Never sent'
         end as reason
    from invoices i
    left join customers c  on c.id = i.customer_id
    left join job_cards j  on j.id = i.job_card_id
    left join customers c2 on c2.id = j.customer_id
   where i.sent is not true
     and i.finalised_at is not null
     and coalesce(i.status, '') not in ('Paid', 'Credited');

create or replace function public.outstanding_statements()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
       public.is_owner()
       or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
     ) then
    raise exception 'Not authorized: owners only';
  end if;

  return (
    select coalesce(jsonb_agg(c order by (c->>'customer_name')), '[]'::jsonb) from (
      select jsonb_build_object(
        'customer_name', cu.name,
        'email', cu.email,
        'total_owing', sum(i.total - coalesce(p.paid,0)),
        'invoices', jsonb_agg(jsonb_build_object(
           'number', i.invoice_number,
           'date',   i.issued_date,
           'total',  i.total,
           'paid',   coalesce(p.paid,0),
           'balance', i.total - coalesce(p.paid,0)
        ) order by i.invoice_number)
      ) as c
      from invoices i
      join job_cards j  on j.id = i.job_card_id
      join customers cu on cu.id = j.customer_id
      left join (select invoice_id, sum(amount) paid from payments group by invoice_id) p on p.invoice_id = i.id
      where i.status in ('Unpaid','Part-paid')
        and i.finalised_at is not null
        and (i.total - coalesce(p.paid,0)) > 0.005
        and cu.email is not null
      group by cu.id, cu.name, cu.email
    ) sub
  );
end;
$function$;

-- ----------------------------------------------------------------------------
-- 14. Rentals issue immediately too — unchanged behaviour, phase 1 scope.
--     This one is not optional. Rentals are reviewed on the Rentals → Approvals
--     tab, which reads invoices_unsent; that view now requires finalised_at, so
--     a rental left as a draft would vanish from the approvals list and simply
--     never be sent. Only the finalise call at the end is new — everything above
--     it is migration 0061's function verbatim.
-- ----------------------------------------------------------------------------
create or replace function public.generate_rental_invoice(p_agreement_id uuid, p_period_start date)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ag       public.rental_agreements;
  v_unit     text;
  v_rent     numeric;
  v_power    numeric;
  v_total    numeric;
  v_gst      numeric;
  v_sub      numeric;
  v_rent_sub numeric;
  v_issued   date;
  v_period   text;
  v_end      date;
  v_n        int;
  v_inv      public.invoices;
begin
  if not (is_approved_staff()
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'Not authorized';
  end if;
  if p_agreement_id is null or p_period_start is null then
    raise exception 'Need an agreement and a period';
  end if;

  select * into v_ag from rental_agreements where id = p_agreement_id;
  if not found then raise exception 'No such agreement'; end if;

  v_n := extract(year  from age(p_period_start, v_ag.start_date))::int * 12
       + extract(month from age(p_period_start, v_ag.start_date))::int;
  if v_n < 0 or (v_ag.start_date + (v_n || ' months')::interval)::date <> p_period_start then
    raise exception 'A rental period must start on the tenancy anniversary of %', v_ag.start_date;
  end if;
  v_end := (v_ag.start_date + ((v_n + 1) || ' months')::interval)::date - 1;

  if v_ag.on_hold
     or v_ag.start_date > p_period_start
     or (v_ag.end_date is not null and v_ag.end_date < p_period_start) then
    return null;
  end if;

  if exists (select 1 from invoices
              where rental_agreement_id = p_agreement_id and period_start = p_period_start) then
    return null;
  end if;

  select name into v_unit from rental_units where id = v_ag.unit_id;

  v_rent  := round(coalesce(v_ag.monthly_rate_incl_gst, 0), 2);
  v_power := round(coalesce(v_ag.power_charge_incl_gst, 0), 2);
  v_total := v_rent + v_power;
  if v_total <= 0 then return null; end if;

  v_gst      := round(v_total * 3 / 23.0, 2);
  v_sub      := v_total - v_gst;
  v_rent_sub := v_rent - round(v_rent * 3 / 23.0, 2);
  v_issued   := p_period_start - 3;
  v_period   := to_char(p_period_start, 'FMDD Mon YYYY') || ' to ' || to_char(v_end, 'FMDD Mon YYYY');

  insert into invoices (customer_id, kind, rental_agreement_id, period_start,
                        subtotal, gst, total, status, issued_date, payment_terms)
    values (v_ag.customer_id, 'rental', p_agreement_id, p_period_start,
            v_sub, v_gst, v_total, 'Unpaid', v_issued, 'days_3')
    returning * into v_inv;

  insert into invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort)
    values (v_inv.id,
            'Rent — ' || coalesce(v_unit, 'unit') || ' — ' || v_period,
            1, v_rent_sub, v_rent_sub, 0);

  if v_power > 0 then
    insert into invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort)
      values (v_inv.id,
              'Power — ' || coalesce(v_unit, 'unit') || ' — ' || v_period,
              1, v_sub - v_rent_sub, v_sub - v_rent_sub, 1);
  end if;

  v_inv := public.finalise_invoice(v_inv.id);

  return v_inv;
end;
$function$;
