-- ============================================================================
-- Betterservice ATV — record a hire by typing the name (31 Aug 2026)
--
-- A hire is a counter transaction: someone walks in, takes the log splitter,
-- pays. Making Craig scroll a dropdown of 56 customers to find them — or add
-- them under Customers first — is slower than the transaction itself.
--
-- So the name is typed. The database matches it to an existing customer
-- (case-insensitive, ignoring stray spaces) and only creates one if there is no
-- match, which keeps the invoice working without breeding duplicate customers
-- every time someone hires something.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.record_hire(
  p_item_id       uuid,
  p_customer_name text,
  p_hire_date     date,
  p_rate_type     text,
  p_notes         text default null,
  p_phone         text default null
)
returns public.hires
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name     text := btrim(coalesce(p_customer_name, ''));
  v_customer uuid;
  v_hire     hires;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  if p_item_id is null then raise exception 'Pick what is being hired.'; end if;
  if v_name = '' then raise exception 'Type the name of whoever is taking it.'; end if;
  if coalesce(p_rate_type, '') not in ('half', 'full') then raise exception 'Half day or full day?'; end if;

  select id into v_customer from customers
   where lower(btrim(name)) = lower(v_name)
   order by created_at
   limit 1;

  if v_customer is null then
    insert into customers (name, phone) values (left(v_name, 120), nullif(btrim(p_phone), ''))
      returning id into v_customer;
  elsif nullif(btrim(p_phone), '') is not null then
    -- Fill a missing phone, never overwrite one already on file.
    update customers set phone = coalesce(nullif(btrim(phone), ''), btrim(p_phone))
     where id = v_customer;
  end if;

  insert into hires (item_id, customer_id, hire_date, rate_type, notes)
    values (p_item_id, v_customer, coalesce(p_hire_date, current_date), p_rate_type,
            nullif(left(btrim(p_notes), 500), ''))
    returning * into v_hire;

  return v_hire;
end;
$$;

revoke execute on function public.record_hire(uuid, text, date, text, text, text) from public, anon;
grant  execute on function public.record_hire(uuid, text, date, text, text, text) to authenticated;
