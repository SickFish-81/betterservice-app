-- Rent periods follow each tenancy, not the calendar.
--
-- Craig lets units as people turn up, so a tenancy starting on the 14th runs
-- the 14th to the 13th, and is invoiced on the 11th. The old rule forced every
-- period to the 1st of a month, which quietly skipped the whole first month for
-- anyone who didn't start on the 1st: generate_rental_invoice() returned null
-- for "not started yet", and nothing ever went back for it.
--
-- Every period is now computed from the tenancy's own start_date as
-- start_date + N months. Computing from the ORIGINAL start each time, rather
-- than from the previous period, is what stops a tenancy that begins on the
-- 31st drifting to the 28th forever once it passes a February.
--
-- Issue date stays three days before the period starts, and payment_terms
-- 'days_3' still makes it due the day the period begins.

-- Which agreements are due to be invoiced today, and for which period.
-- Same +/- 3 day window as before, so a failed day heals the next morning, and
-- the unique index on (rental_agreement_id, period_start) still makes
-- double-billing impossible however often the job fires.
create or replace function public.rental_periods_due(p_today date default current_date)
returns table (agreement_id uuid, period_start date, period_end date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select ra.id, p.ps, p.pe
  from public.rental_agreements ra
  cross join lateral (
    -- Whole months from the tenancy's start to today, and its neighbours, so
    -- the window can reach a period that hasn't quite begun.
    select generate_series(greatest(0, m.mo - 1), greatest(0, m.mo + 1)) as n
    from (
      select extract(year  from age(p_today, ra.start_date))::int * 12
           + extract(month from age(p_today, ra.start_date))::int as mo
    ) m
  ) g
  cross join lateral (
    select (ra.start_date + (g.n       || ' months')::interval)::date       as ps,
           (ra.start_date + ((g.n + 1) || ' months')::interval)::date - 1   as pe
  ) p
  where not ra.on_hold
    and p.ps >= ra.start_date
    and (ra.end_date is null or p.ps <= ra.end_date)
    and p.ps between p_today - 3 and p_today + 3
    and not exists (
      select 1 from public.invoices i
       where i.rental_agreement_id = ra.id
         and i.period_start = p.ps
    );
$$;

revoke all on function public.rental_periods_due(date) from public, anon;
grant execute on function public.rental_periods_due(date) to authenticated, service_role;

comment on function public.rental_periods_due(date) is
  'Agreements due for invoicing today, with the period each covers. Periods run from the tenancy start date, not the calendar month.';


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

  -- A period must land on the tenancy's own monthly anniversary. Anything else
  -- is a typo, and a typo here bills a tenant for a month that doesn't exist.
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

  -- GST from the combined total; the rent line takes its share, power the rest.
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

  return v_inv;
end;
$function$;
