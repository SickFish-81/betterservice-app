-- ============================================================================
-- Betterservice ATV — rentals (30 Aug 2026)
--
-- Ten small units and one large shed, let monthly. Rent is billed three days
-- before the period it covers (29 Aug for 1 Sep), due on the 1st, and collected
-- by automatic payment. The issue date is derived from the PERIOD, never from
-- "today", so a generator run that fires late still stamps the correct dates —
-- the email is simply a day later, rather than the whole invoice being wrong.
--
-- Rates are held GST-INCLUSIVE, because that is what the tenant's automatic
-- payment is set to. GST is extracted at 3/23 (the NZ rule for a
-- GST-inclusive amount), so the invoice total is exactly the agreed rent.
-- This is the opposite convention to job cards, where prices are exclusive and
-- 15% is added — hence the explicit column name.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1. Rent and hireage get their own income accounts. Without this both would
--    land in 420 "Sales — Other", which would make the three-way split
--    invisible in the P&L — most of the point of separating them.
insert into public.accounts (code, name, type)
  select '430', 'Sales — Rentals', 'income'
   where not exists (select 1 from public.accounts where code = '430');
insert into public.accounts (code, name, type)
  select '440', 'Sales — Hireage', 'income'
   where not exists (select 1 from public.accounts where code = '440');

-- 2. The units themselves.
create table if not exists public.rental_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 3. Who is in each unit, at what rent, for how long.
create table if not exists public.rental_agreements (
  id                    uuid primary key default gen_random_uuid(),
  unit_id               uuid not null references public.rental_units(id),
  customer_id           uuid not null references public.customers(id),
  monthly_rate_incl_gst numeric not null check (monthly_rate_incl_gst >= 0),
  start_date            date not null,
  end_date              date,
  on_hold               boolean not null default false,
  lease_pdf_path        text,
  lease_sent_at         timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index if not exists rental_agreements_unit_idx on public.rental_agreements (unit_id);
create index if not exists rental_agreements_customer_idx on public.rental_agreements (customer_id);

-- 4. An invoice knows which agreement and which month it is for. The unique
--    index is what makes the generator safe to run every day: the same rent can
--    never be billed twice for the same period, however often the job fires.
alter table public.invoices
  add column if not exists rental_agreement_id uuid references public.rental_agreements(id),
  add column if not exists period_start date;

create unique index if not exists invoices_rental_period_uniq
  on public.invoices (rental_agreement_id, period_start)
  where rental_agreement_id is not null;

-- 5. Post rent and hireage to their own income accounts. Job-card invoices keep
--    their existing labour/parts split exactly as before.
create or replace function public.ledger_on_invoice_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lab numeric; v_par numeric; v_base numeric;
  v_clab numeric := 0; v_cpar numeric := 0; v_coth numeric; v_lines jsonb; v_no text;
  v_income text;
begin
  if exists (select 1 from journal_entries where source_type='invoice' and source_id = NEW.id) then
    return NEW;
  end if;
  v_no := 'Invoice #' || lpad(NEW.invoice_number::text, 5, '0');

  -- Rent and hireage have no job lines; the whole subtotal is one kind of income.
  if NEW.kind in ('rental', 'hire') then
    v_income := case NEW.kind when 'rental' then '430' else '440' end;
    v_lines := jsonb_build_array(jsonb_build_object('account_code','110','debit', NEW.total, 'memo', v_no));
    if coalesce(NEW.subtotal,0) <> 0 then
      v_lines := v_lines || jsonb_build_object('account_code', v_income, 'credit', NEW.subtotal);
    end if;
    if coalesce(NEW.gst,0) > 0 then
      v_lines := v_lines || jsonb_build_object('account_code','200','credit', NEW.gst);
    end if;
    perform post_entry(coalesce(NEW.issued_date, current_date), v_no, 'invoice', NEW.id, v_lines);
    return NEW;
  end if;

  select coalesce(sum(case when kind='labour' then amount else 0 end),0),
         coalesce(sum(case when kind='part'   then amount else 0 end),0)
    into v_lab, v_par
    from job_line_items where job_card_id = NEW.job_card_id;
  v_base := v_lab + v_par;
  v_coth := coalesce(NEW.subtotal,0);
  if v_base > 0 then
    v_clab := round(coalesce(NEW.subtotal,0) * v_lab / v_base, 2);
    v_cpar := round(coalesce(NEW.subtotal,0) * v_par / v_base, 2);
    v_coth := round(coalesce(NEW.subtotal,0) - v_clab - v_cpar, 2);
  end if;

  v_lines := jsonb_build_array(jsonb_build_object('account_code','110','debit', NEW.total, 'memo', v_no));
  if v_clab > 0 then v_lines := v_lines || jsonb_build_object('account_code','400','credit', v_clab); end if;
  if v_cpar > 0 then v_lines := v_lines || jsonb_build_object('account_code','410','credit', v_cpar); end if;
  if v_coth <> 0 then v_lines := v_lines || jsonb_build_object('account_code','420','credit', v_coth); end if;
  if coalesce(NEW.gst,0) > 0 then v_lines := v_lines || jsonb_build_object('account_code','200','credit', NEW.gst); end if;

  perform post_entry(coalesce(NEW.issued_date, current_date), v_no, 'invoice', NEW.id, v_lines);
  return NEW;
end $function$;

-- 6. The generator. Money is computed here, on the server, from the agreement —
--    the same rule as generate_invoice() for job cards. Returns null when the
--    agreement is not billable for that period (ended, on hold, not started, or
--    already invoiced), so the caller can loop over every agreement daily
--    without needing to know any of that.
create or replace function public.generate_rental_invoice(p_agreement_id uuid, p_period_start date)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ag      public.rental_agreements;
  v_unit    text;
  v_total   numeric;
  v_gst     numeric;
  v_sub     numeric;
  v_issued  date;
  v_inv     public.invoices;
begin
  if not (is_approved_staff()
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'Not authorized';
  end if;
  if p_agreement_id is null or p_period_start is null then
    raise exception 'Need an agreement and a period';
  end if;
  if p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'A rental period starts on the first of a month';
  end if;

  select * into v_ag from rental_agreements where id = p_agreement_id;
  if not found then raise exception 'No such agreement'; end if;

  -- Not billable for this period: ended, on hold, or not started yet.
  if v_ag.on_hold
     or v_ag.start_date > p_period_start
     or (v_ag.end_date is not null and v_ag.end_date < p_period_start) then
    return null;
  end if;

  -- Already invoiced for this period.
  if exists (select 1 from invoices
              where rental_agreement_id = p_agreement_id and period_start = p_period_start) then
    return null;
  end if;

  select name into v_unit from rental_units where id = v_ag.unit_id;

  -- The rate is what the tenant pays. Extract the GST rather than adding it.
  v_total  := round(v_ag.monthly_rate_incl_gst, 2);
  v_gst    := round(v_total * 3 / 23.0, 2);
  v_sub    := v_total - v_gst;
  v_issued := p_period_start - 3;

  insert into invoices (customer_id, kind, rental_agreement_id, period_start,
                        subtotal, gst, total, status, issued_date, payment_terms)
    values (v_ag.customer_id, 'rental', p_agreement_id, p_period_start,
            v_sub, v_gst, v_total, 'Unpaid', v_issued, 'days_3')
    returning * into v_inv;

  insert into invoice_line_items (invoice_id, description, quantity, unit_price, amount)
    values (v_inv.id,
            'Rent — ' || coalesce(v_unit, 'unit') || ' — ' || to_char(p_period_start, 'FMMonth YYYY'),
            1, v_sub, v_sub);

  return v_inv;
end;
$$;

revoke execute on function public.generate_rental_invoice(uuid, date) from public, anon;
grant  execute on function public.generate_rental_invoice(uuid, date) to authenticated, service_role;

-- 7. RLS. Staff can see the units and agreements; only an owner can change them,
--    because they are what the money is generated from.
alter table public.rental_units enable row level security;
alter table public.rental_agreements enable row level security;

drop policy if exists ru_select on public.rental_units;
create policy ru_select on public.rental_units for select using (is_approved_staff());
drop policy if exists ru_write on public.rental_units;
create policy ru_write on public.rental_units for all using (is_owner()) with check (is_owner());

drop policy if exists ra_select on public.rental_agreements;
create policy ra_select on public.rental_agreements for select using (is_approved_staff());
drop policy if exists ra_write on public.rental_agreements;
create policy ra_write on public.rental_agreements for all using (is_owner()) with check (is_owner());

revoke all on public.rental_units, public.rental_agreements from anon;
grant select, insert, update, delete on public.rental_units, public.rental_agreements to authenticated;

-- 8. The eleven units. Names only — tenants, rates and dates are entered in the app.
insert into public.rental_units (name, description)
  select v.name, v.description
    from (values
      ('Unit 1',  'Small unit'), ('Unit 2',  'Small unit'), ('Unit 3',  'Small unit'),
      ('Unit 4',  'Small unit'), ('Unit 5',  'Small unit'), ('Unit 6',  'Small unit'),
      ('Unit 7',  'Small unit'), ('Unit 8',  'Small unit'), ('Unit 9',  'Small unit'),
      ('Unit 10', 'Small unit'), ('Large Shed', 'Large shed')
    ) as v(name, description)
   where not exists (select 1 from public.rental_units u where u.name = v.name);
