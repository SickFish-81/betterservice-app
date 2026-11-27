-- Car parks in the rental system (27 Nov 2026).
--
-- Ben: "Car parking slots added to rental system, craig has people parking in
-- spaces and wants to charge them for it." His calls, in order:
--   * like the units: a tenant per space, invoices prepared automatically and
--     approved by Craig before they go;
--   * charged by the WEEK, but the length adjustable ("default to a week, but
--     have it adjustable so if they only have 3 days"), chosen over pro-rata
--     and over a separate day rate;
--   * car parks get their own section on the Rentals page;
--   * "Craig should be able to 'stop' the rental on the spot, and it charge up
--     to that time" -> car parks are billed IN ARREARS, for the days actually
--     used, chosen over billing in advance and crediting the unused days.
--
-- This adds:
--   * rental_units.kind              'unit' (everything so far) or 'car_park'.
--   * rental_agreements.period_days  NULL = monthly, as every tenancy so far.
--                                    A number = a period of that many days from
--                                    the start date (7 = weekly).
--   * rental_agreements.in_arrears   false = invoiced 3 days BEFORE each period
--                                    (the units, unchanged). true = invoiced the
--                                    day AFTER each period, for what was used.
--                                    The page sets true for a car park.
--     monthly_rate_incl_gst keeps its name but now means "the charge for one
--     period": a month's rent for a unit, a week's parking for a car park.
--   * rental_periods_due() and generate_rental_invoice() learn day periods and
--     arrears. In arrears, every finished period not yet invoiced is due, back
--     to the start date, so dates typed in after the fact are all charged. A period cut short by the end date is charged for its days: a
--     car park stopped on day 3 of a $50 week is 3/7 of $50 = $21.43.
--   * stop_rental(agreement): an owner ends a car park tenancy today (or on a
--     date they give, not in the future) and its final invoice is made there
--     and then, plus any whole periods the nightly job hasn't caught yet.
--
-- Monthly tenancies come out EXACTLY as before: that branch is the old
-- arithmetic unchanged, and the dry run compared old and new due periods for
-- every agreement over 440 days before this was applied.
--
-- No DROP anywhere (the Supabase tool hangs on it). Both existing functions
-- keep their signatures, so create or replace is enough.

alter table public.rental_units
  add column if not exists kind text not null default 'unit';
alter table public.rental_units
  add constraint rental_units_kind_check check (kind in ('unit', 'car_park'));
comment on column public.rental_units.kind is 'unit = a storage unit, the shed or the sign space; car_park = a parking space.';

alter table public.rental_agreements
  add column if not exists period_days integer,
  add column if not exists in_arrears boolean not null default false;
alter table public.rental_agreements
  add constraint rental_agreements_period_days_check check (period_days is null or period_days between 1 and 90);
-- Arrears are charged by the day for a short last period, which needs a period
-- measured in days.
alter table public.rental_agreements
  add constraint rental_agreements_arrears_needs_days check (not in_arrears or period_days is not null);
comment on column public.rental_agreements.period_days is 'NULL = billed monthly on the start date''s day of the month. A number = a period of that many days from start_date (7 = weekly).';
comment on column public.rental_agreements.in_arrears is 'false = invoiced 3 days before each period starts (units). true = invoiced after each period ends, for the days used (car parks).';
comment on column public.rental_agreements.monthly_rate_incl_gst is 'The charge for one period, GST inclusive: per MONTH when period_days is null, otherwise per period_days days.';

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
    select case when ra.period_days is not null
                then ra.start_date + ra.period_days * g.n
                else (ra.start_date + (g.n || ' months')::interval)::date
           end as ps,
           case when ra.period_days is null
                then (ra.start_date + ((g.n + 1) || ' months')::interval)::date - 1
                when ra.in_arrears and ra.end_date is not null
                then least(ra.start_date + ra.period_days * (g.n + 1) - 1, ra.end_date)
                else ra.start_date + ra.period_days * (g.n + 1) - 1
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
    if v_ag.end_date is not null and v_ag.end_date < v_end then
      v_end := v_ag.end_date;
    end if;
    if v_end > v_today then return null; end if;
    v_days := v_end - p_period_start + 1;
  end if;

  select name, kind into v_unit, v_kind from rental_units where id = v_ag.unit_id;
  v_label := case when v_kind = 'car_park' then 'Parking' else 'Rent' end;

  v_rent := round(coalesce(v_ag.monthly_rate_incl_gst, 0), 2);
  if v_days is not null and v_days < v_ag.period_days then
    v_rent := round(v_rent * v_days / v_ag.period_days, 2);
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
                || case when v_days is not null and v_days < v_ag.period_days
                        then ' (' || v_days || ' of ' || v_ag.period_days || ' days)' else '' end;

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

-- Stop a car park on the spot. Ends the tenancy on p_stop_date (today if not
-- given; never in the future, never before it started), then makes every
-- invoice not yet made up to and including that day: normally just the last,
-- part-used period, plus any whole one the nightly job hasn't reached yet.
-- Returns the invoices it made, so the page can file their PDFs straight away.
--
-- Only for tenancies billed in arrears. A unit's rent is invoiced in advance,
-- so stopping one means crediting what was already charged; that stays a
-- deliberate, manual job.
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
  if exists (select 1 from invoices i
              where i.rental_agreement_id = p_agreement_id
                and i.period_start + v_ag.period_days - 1 > v_stop) then
    raise exception 'This tenancy has already been invoiced past %. Adjust or discard that invoice first.', v_stop;
  end if;

  update rental_agreements set end_date = v_stop where id = p_agreement_id;

  v_ps := v_ag.start_date;
  while v_ps <= v_stop loop
    v_inv := public.generate_rental_invoice(p_agreement_id, v_ps);
    if v_inv.id is not null then return next v_inv; end if;
    v_ps := v_ps + v_ag.period_days;
  end loop;
end;
$function$;

revoke execute on function public.stop_rental(uuid, date) from public, anon;
grant  execute on function public.stop_rental(uuid, date) to authenticated;
