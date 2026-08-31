-- ============================================================================
-- Betterservice ATV — hireage (31 Aug 2026)
--
-- Gear hired out by the day. One item to begin with, the log splitter, but it is
-- a table rather than two hard-coded numbers so the next machine is a row.
--
-- Rates are GST-INCLUSIVE — Craig quotes "$150 for the day" and that is what the
-- customer hands over — so GST is extracted at 3/23 rather than added on top,
-- same as rent. Terms are due-on-receipt: a hire is paid when it goes out or
-- when it comes back, not put on account.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.hire_items (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null unique,
  half_day_rate_incl_gst  numeric not null check (half_day_rate_incl_gst >= 0),
  full_day_rate_incl_gst  numeric not null check (full_day_rate_incl_gst >= 0),
  active                  boolean not null default true,
  created_at              timestamptz not null default now()
);

create table if not exists public.hires (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.hire_items(id),
  customer_id uuid not null references public.customers(id),
  hire_date   date not null default current_date,
  rate_type   text not null check (rate_type in ('half', 'full')),
  notes       text,
  invoice_id  uuid references public.invoices(id),
  created_at  timestamptz not null default now()
);

create index if not exists hires_date_idx on public.hires (hire_date desc);

insert into public.hire_items (name, half_day_rate_incl_gst, full_day_rate_incl_gst)
  select 'Log Splitter', 100, 150
   where not exists (select 1 from public.hire_items where name = 'Log Splitter');

-- ---------------------------------------------------------------------------
-- Invoice a hire. Money computed here, from the item's rate — the browser never
-- sends an amount, same rule as job cards and rent.
-- ---------------------------------------------------------------------------
create or replace function public.generate_hire_invoice(p_hire_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $$
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
  return v_inv;
end;
$$;

revoke execute on function public.generate_hire_invoice(uuid) from public, anon;
grant  execute on function public.generate_hire_invoice(uuid) to authenticated;

alter table public.hire_items enable row level security;
alter table public.hires enable row level security;

drop policy if exists hi_select on public.hire_items;
create policy hi_select on public.hire_items for select using (is_approved_staff());
drop policy if exists hi_write on public.hire_items;
create policy hi_write on public.hire_items for all using (is_owner()) with check (is_owner());

drop policy if exists h_select on public.hires;
create policy h_select on public.hires for select using (is_approved_staff());
drop policy if exists h_write on public.hires;
create policy h_write on public.hires for all using (is_approved_staff()) with check (is_approved_staff());

revoke all on public.hire_items, public.hires from anon;
grant select, insert, update, delete on public.hire_items, public.hires to authenticated;
