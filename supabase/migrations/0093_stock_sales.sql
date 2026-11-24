-- Stock: record the sale, and hand the bike to its new owner (24 Nov 2026).
--
-- Craig, by email ("Problem", 25 Nov): "put in the put up for sale, date
-- actually sold, who to (contact details) and for how much ... And maybe a
-- notes file. Then if the bike could automatically be loaded into the system
-- under the new owner with a 12 month service reminder set."
--
-- Ben's calls: the sale price is owner-only, like the asking price; the 12
-- months count from the date sold; the key number stays on the bike.
--
--   * for_sale_at          the day it went up for sale. Filled in by itself the
--                          first time a row reaches "For sale", and editable.
--   * sold_to_customer_id  the buyer (a normal customer record).
--   * sold_price           what it actually went for, incl GST. Owner-only.
--   * sell_stock_item()    one call does the whole sale: makes the buyer's
--                          customer record if they're new, marks the row Sold,
--                          moves the machine to the buyer, and sets its service
--                          date to the sale date. The reminder system (the Due
--                          list and the daily text, migration 0015) already
--                          picks a machine up 12 months after that date.
--
-- Past jobs and invoices keep their own customer_id, so the workshop history
-- stays under Betterservice sales; only the machine moves.

alter table public.stock_items
  add column if not exists for_sale_at date,
  add column if not exists sold_to_customer_id uuid references public.customers(id),
  add column if not exists sold_price numeric(10, 2) check (sold_price is null or sold_price >= 0);

comment on column public.stock_items.for_sale_at is 'The day it went up for sale. Set automatically the first time stage becomes For sale.';
comment on column public.stock_items.sold_to_customer_id is 'The buyer. Set by sell_stock_item().';
comment on column public.stock_items.sold_price is 'What it sold for, incl GST. Owner-only.';

create index if not exists stock_items_sold_to_idx on public.stock_items (sold_to_customer_id);

-- The guard gains the sale price (owner-only, same as the asking price) and the
-- automatic for-sale date. SECURITY INVOKER as before, so current_user is the
-- caller.
create or replace function public.stock_items_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_system boolean := current_user in ('postgres', 'supabase_admin', 'service_role');
  v_today date := (now() at time zone 'Pacific/Auckland')::date;
begin
  if not v_system and not is_owner() then
    if (tg_op = 'INSERT' and new.asking_price is not null)
       or (tg_op = 'UPDATE' and new.asking_price is distinct from old.asking_price) then
      raise exception 'Only Craig or Ben can set a price.';
    end if;
    if (tg_op = 'INSERT' and new.sold_price is not null)
       or (tg_op = 'UPDATE' and new.sold_price is distinct from old.sold_price) then
      raise exception 'Only Craig or Ben can enter the sale price.';
    end if;
    if (tg_op = 'INSERT' and new.listing_id is not null)
       or (tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id) then
      raise exception 'Only Craig or Ben can put a machine on the website.';
    end if;
  end if;
  -- Only on the way into For sale, so a row that was already For sale before
  -- this column existed doesn't get today's date the next time it's edited.
  if new.stage = 'For sale' and new.for_sale_at is null
     and (tg_op = 'INSERT' or old.stage is distinct from 'For sale') then
    new.for_sale_at := v_today;
  end if;
  if new.stage = 'Sold' and new.sold_at is null then new.sold_at := v_today; end if;
  if new.stage <> 'Sold' then new.sold_at := null; end if;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.sell_stock_item(
  p_stock_id    uuid,
  p_sold_at     date,
  p_customer_id uuid,     -- an existing customer, or null to make a new one from the fields below
  p_name        text,
  p_phone       text,
  p_email       text,
  p_address     text,
  p_price       numeric,  -- incl GST; owners only
  p_notes       text      -- replaces the row's notes when given
)
returns uuid               -- the buyer's customer id
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row   stock_items;
  v_cust  uuid := p_customer_id;
  v_today date := (now() at time zone 'Pacific/Auckland')::date;
  v_date  date := coalesce(p_sold_at, (now() at time zone 'Pacific/Auckland')::date);
begin
  if not is_approved_staff() then raise exception 'Not allowed.'; end if;

  select * into v_row from stock_items where id = p_stock_id for update;
  if not found then raise exception 'That stock row no longer exists.'; end if;
  if v_row.stage = 'Sold' then raise exception 'This machine is already marked sold.'; end if;

  if p_price is not null and not is_owner() then raise exception 'Only Craig or Ben can enter the sale price.'; end if;
  if p_price is not null and p_price < 0 then raise exception 'The sale price can''t be negative.'; end if;
  if v_date > v_today then raise exception 'The sale date can''t be in the future.'; end if;

  if v_cust is null then
    if coalesce(btrim(p_name), '') = '' then
      raise exception 'Enter the buyer''s name, or pick them from the customer list.';
    end if;
    insert into customers (name, phone, email, address)
    values (btrim(p_name), nullif(btrim(p_phone), ''), nullif(lower(btrim(p_email)), ''), nullif(btrim(p_address), ''))
    returning id into v_cust;
  elsif not exists (select 1 from customers where id = v_cust) then
    raise exception 'That customer no longer exists.';
  end if;

  update stock_items
     set stage = 'Sold',
         sold_at = v_date,
         sold_to_customer_id = v_cust,
         sold_price = p_price,
         notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end
   where id = p_stock_id;

  -- The bike now belongs to the buyer, and its reminder clock starts on the
  -- day it sold. Clearing last_reminder_sent means a reminder sent to the
  -- previous owner can't stop the new owner's one.
  update machines
     set customer_id = v_cust,
         last_service_date = v_date,
         last_reminder_sent = null
   where id = v_row.machine_id;

  return v_cust;
end;
$function$;

revoke execute on function public.sell_stock_item(uuid, date, uuid, text, text, text, text, numeric, text) from public, anon;
grant  execute on function public.sell_stock_item(uuid, date, uuid, text, text, text, text, numeric, text) to authenticated;

-- Rows already For sale: take the date from the website listing where there is
-- one. The others stay blank for Craig to fill in.
update public.stock_items s
   set for_sale_at = (l.created_at at time zone 'Pacific/Auckland')::date
  from public.secondhand_listings l
 where l.id = s.listing_id
   and s.for_sale_at is null
   and s.stage in ('For sale', 'Sold');
