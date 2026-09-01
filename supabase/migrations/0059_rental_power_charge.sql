-- ============================================================================
-- Betterservice ATV — power on-charge on a tenancy (1 Sep 2026)
--
-- Some units draw power, and Craig recovers it monthly. It goes on the same
-- invoice as its own line, so the tenant can see what is rent and what is power
-- rather than wondering why the rent changed.
--
-- GST-inclusive like the rent, for the same reason: it's what the tenant's
-- automatic payment is set to.
--
-- Rounding note: GST is extracted from the COMBINED total, then the rent line
-- takes its own share and the power line takes the remainder. That way the two
-- lines always add up to the invoice subtotal exactly — splitting the rounding
-- per line is how invoices end up a cent out.
--
-- Existing tenancies default to 0, so nothing changes for anyone until Craig
-- sets a figure.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.rental_agreements
  add column if not exists power_charge_incl_gst numeric not null default 0;

alter table public.rental_agreements drop constraint if exists rental_agreements_power_sane;
alter table public.rental_agreements add constraint rental_agreements_power_sane
  check (power_charge_incl_gst >= 0);

create or replace function public.generate_rental_invoice(p_agreement_id uuid, p_period_start date)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $$
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
  v_inv      public.invoices;
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
  v_period   := to_char(p_period_start, 'FMMonth YYYY');

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
$$;

revoke execute on function public.generate_rental_invoice(uuid, date) from public, anon;
grant  execute on function public.generate_rental_invoice(uuid, date) to authenticated, service_role;
