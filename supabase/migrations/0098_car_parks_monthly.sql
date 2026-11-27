-- Car parks default to MONTHLY (27 Nov 2026), still charged after use.
--
-- Ben, after 0097 went live: "actually can we default to monthly like all the
-- other invoices he can still adjust". So a car park's charge is monthly unless
-- Craig sets "every so many days" instead. It stays charged in ARREARS either
-- way, because that is what lets Stop charge "up to that time": a monthly car
-- park is invoiced the day after each month ends, and one stopped on day 10 of
-- a 30-day month is charged 10/30 of the monthly figure.
--
-- What changes from 0097:
--   * in_arrears no longer requires period_days (the constraint goes).
--   * rental_periods_due() cuts a monthly arrears period short at the end date,
--     as it already did for day periods.
--   * generate_rental_invoice() charges a short period by its own length (the
--     days in THAT month, or period_days), not by period_days alone.
--   * stop_rental() steps through monthly periods as well as day ones.
--
-- Units are untouched: none is in arrears, so every branch they take is the
-- same code as before. Proved in the dry run before applying.

alter table public.rental_agreements drop constraint if exists rental_agreements_arrears_needs_days;
comment on column public.rental_agreements.in_arrears is 'false = invoiced 3 days before each period starts (units). true = invoiced after each period ends, for the days used (car parks). Monthly or by days.';

create or replace function public.rental_periods_due(p_today date default current_date)
returns table(agreement_id uuid, period_start date, period_end date)
language sql
stable security definer
set search_path to 'public'
as $function$
  select ra.id, p.ps, p.pe
  from public.rental_agreements ra
  cross join lateral (
    -- Rent in advance: the periods around today, enough to cover +/- 3 days
    -- around a period start (one each side for a month or a week).
    -- Arrears: EVERY period from the tenancy's start up to today, so a stay
    -- entered after the fact has all its finished periods charged.
    select generate_series(case when ra.in_arrears then 0 else greatest(0, m.k - m.back) end,
                           greatest(0, m.k + m.ahead)) as n
    from (
      select case when ra.period_days is not null
                  then floor((p_today - ra.start_date) / ra.period_days::numeric)::int
                  else extract(year  from age(p_today, ra.start_date))::int * 12
                     + extract(month from age(p_today, ra.start_date))::int
             end as k,
             case when ra.period_days is not null then ceil(3.0 / ra.period_days)::int
                  else 1
             end as back,
             case when ra.in_arrears then 0
                  when ra.period_days is not null then ceil(3.0 / ra.period_days)::int
                  else 1
             end as ahead
    ) m
  ) g
  cross join lateral (
    select case when ra.period_days is null
                then (ra.start_date + ((g.n + 1) || ' months')::interval)::date - 1
                else ra.start_date + ra.period_days * (g.n + 1) - 1
           end as raw_pe
  ) r
  cross join lateral (
    select case when ra.period_days is not null
                then ra.start_date + ra.period_days * g.n
                else (ra.start_date + (g.n || ' months')::interval)::date
           end as ps,
           -- In arrears a period is cut short by the end date, monthly or not.
           case when ra.in_arrears and ra.end_date is not null
                then least(r.raw_pe, ra.end_date)
                else r.raw_pe
           end as pe
  ) p
  where not ra.on_hold
    and p.ps >= ra.start_date
    and (ra.end_date is null or p.ps <= ra.end_date)
    and case when ra.in_arrears
             then p.pe < p_today
             else p.ps between p_today - 3 and p_today + 3
        end
    and not exists (
      select 1 from public.invoices i
       where i.rental_agreement_id = ra.id
         and i.period_start = p.ps
    );
$function$;

create or replace function public.generate_rental_invoice(p_agreement_id uuid, p_period_start date)
returns invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ag       public.rental_agreements;
  v_unit     text;
  v_kind     text;
  v_label    text;
  v_rent     numeric;
  v_power    numeric;
  v_total    numeric;
  v_gst      numeric;
  v_sub      numeric;
  v_rent_sub numeric;
  v_issued   date;
  v_period   text;
  v_end      date;
  v_days     int;
  v_len      int;
  v_n        int;
  v_today    date := (now() at time zone 'Pacific/Auckland')::date;
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

  if v_ag.period_days is not null then
    if p_period_start < v_ag.start_date or (p_period_start - v_ag.start_date) % v_ag.period_days <> 0 then
      raise exception 'This tenancy is billed every % days from %, and % is not the start of one of its periods',
        v_ag.period_days, v_ag.start_date, p_period_start;
    end if;
    v_end := p_period_start + v_ag.period_days - 1;
  else
    v_n := extract(year  from age(p_period_start, v_ag.start_date))::int * 12
         + extract(month from age(p_period_start, v_ag.start_date))::int;
    if v_n < 0 or (v_ag.start_date + (v_n || ' months')::interval)::date <> p_period_start then
      raise exception 'A rental period must start on the tenancy anniversary of %', v_ag.start_date;
    end if;
    v_end := (v_ag.start_date + ((v_n + 1) || ' months')::interval)::date - 1;
  end if;

  if v_ag.on_hold
     or v_ag.start_date > p_period_start
     or (v_ag.end_date is not null and v_ag.end_date < p_period_start) then
    return null;
  end if;

  if exists (select 1 from invoices
              where rental_agreement_id = p_agreement_id and period_start = p_period_start) then
    return null;
  end if;

  -- In arrears: charge only a period that is over, and only the days of it the
  -- tenancy actually ran. A period still running has nothing to charge yet.
  if v_ag.in_arrears then
    v_len := v_end - p_period_start + 1;   -- the whole period, before any cut
    if v_ag.end_date is not null and v_ag.end_date < v_end then
      v_end := v_ag.end_date;
    end if;
    if v_end > v_today then return null; end if;
    v_days := v_end - p_period_start + 1;
  end if;

  select name, kind into v_unit, v_kind from rental_units where id = v_ag.unit_id;
  v_label := case when v_kind = 'car_park' then 'Parking' else 'Rent' end;

  v_rent := round(coalesce(v_ag.monthly_rate_incl_gst, 0), 2);
  if v_days is not null and v_days < v_len then
    v_rent := round(v_rent * v_days / v_len, 2);
  end if;
  v_power := round(coalesce(v_ag.power_charge_incl_gst, 0), 2);
  v_total := v_rent + v_power;
  if v_total <= 0 then return null; end if;

  v_gst      := round(v_total * 3 / 23.0, 2);
  v_sub      := v_total - v_gst;
  v_rent_sub := v_rent - round(v_rent * 3 / 23.0, 2);
  -- In advance: issued 3 days before the period, due the day it starts.
  -- In arrears: issued when it is made (the day after, or the day it's stopped).
  v_issued   := case when v_ag.in_arrears then v_today else p_period_start - 3 end;
  v_period   := to_char(p_period_start, 'FMDD Mon YYYY') || ' to ' || to_char(v_end, 'FMDD Mon YYYY')
                || case when v_days is not null and v_days < v_len
                        then ' (' || v_days || ' of ' || v_len || ' days)' else '' end;

  insert into invoices (customer_id, kind, rental_agreement_id, period_start,
                        subtotal, gst, total, status, issued_date, payment_terms)
    values (v_ag.customer_id, 'rental', p_agreement_id, p_period_start,
            v_sub, v_gst, v_total, 'Unpaid', v_issued, 'days_3')
    returning * into v_inv;

  insert into invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort)
    values (v_inv.id,
            v_label || ' — ' || coalesce(v_unit, 'unit') || ' — ' || v_period,
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

create or replace function public.stop_rental(p_agreement_id uuid, p_stop_date date default null)
returns setof invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ag    public.rental_agreements;
  v_today date := (now() at time zone 'Pacific/Auckland')::date;
  v_stop  date;
  v_ps    date;
  v_cur   date;
  v_n     int;
  v_inv   public.invoices;
begin
  if not is_owner() then raise exception 'Only an owner can stop a rental'; end if;

  select * into v_ag from rental_agreements where id = p_agreement_id for update;
  if not found then raise exception 'No such tenancy'; end if;
  if not v_ag.in_arrears then
    raise exception 'Only car parks can be stopped this way. To end a unit''s tenancy, set its end date.';
  end if;

  v_stop := coalesce(p_stop_date, v_today);
  if v_stop > v_today then raise exception 'The stop date can''t be in the future'; end if;
  if v_stop < v_ag.start_date then
    raise exception 'That is before this tenancy started (%). If it was entered by mistake, remove it instead.', v_ag.start_date;
  end if;
  if v_ag.end_date is not null and v_ag.end_date < v_stop then
    raise exception 'This tenancy already ended on %', v_ag.end_date;
  end if;
  -- A period already invoiced in full past the stop date can't be shortened
  -- here: that would mean a credit note, not a new invoice.
  -- The period running on the stop date. If it (or a later one) is already
  -- invoiced, shortening it would mean a credit note, not a new invoice.
  if v_ag.period_days is not null then
    v_cur := v_ag.start_date + v_ag.period_days * floor((v_stop - v_ag.start_date) / v_ag.period_days::numeric)::int;
  else
    v_n := extract(year  from age(v_stop, v_ag.start_date))::int * 12
         + extract(month from age(v_stop, v_ag.start_date))::int;
    v_cur := (v_ag.start_date + (v_n || ' months')::interval)::date;
  end if;
  if exists (select 1 from invoices i
              where i.rental_agreement_id = p_agreement_id
                and i.period_start >= v_cur) then
    raise exception 'This tenancy has already been invoiced past %. Adjust or discard that invoice first.', v_stop;
  end if;

  update rental_agreements set end_date = v_stop where id = p_agreement_id;

  v_n := 0;
  loop
    v_ps := case when v_ag.period_days is not null
                 then v_ag.start_date + v_ag.period_days * v_n
                 else (v_ag.start_date + (v_n || ' months')::interval)::date
            end;
    exit when v_ps > v_stop;
    v_inv := public.generate_rental_invoice(p_agreement_id, v_ps);
    if v_inv.id is not null then return next v_inv; end if;
    v_n := v_n + 1;
  end loop;
end;
$function$;
