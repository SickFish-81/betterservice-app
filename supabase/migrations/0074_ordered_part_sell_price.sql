-- ============================================================================
-- Betterservice ATV — let a sell price be set directly on an ordered-in part
-- (7 Oct 2026)
--
-- Craig: "parts ordered in for this job — this has cost price only, add a sell
-- price as the default isn't always right." The shop's markup (Settings >
-- parts_markup_percent) is still the default — most parts should just use it —
-- but some are quoted to the customer at a round number, discounted, or marked
-- up differently, and until now the only way to get a different charge was to
-- add the part, then edit the line afterwards.
--
-- p_sell_price is optional and defaults to null, so every existing caller
-- (and the 6-argument signature from 0053) keeps working unchanged. When it's
-- given, it's used as the charge outright; when it's left out, the markup
-- calculation runs exactly as it did before.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create or replace function public.add_ordered_part_to_job(
  p_job_id       uuid,
  p_description  text,
  p_qty          numeric,
  p_cost         numeric,
  p_supplier_id  uuid default null,
  p_supplier_ref text default null,
  p_sell_price   numeric default null
)
returns public.job_line_items
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_markup numeric;
  v_price  numeric;
  v_row    job_line_items;
begin
  if not is_approved_staff() then raise exception 'Not authorized'; end if;
  if p_job_id is null then raise exception 'No job specified'; end if;
  if coalesce(btrim(p_description), '') = '' then raise exception 'Give the part a name.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero.'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'Enter what the part cost you.'; end if;
  if p_sell_price is not null and p_sell_price < 0 then raise exception 'Sell price can''t be negative.'; end if;
  if exists (select 1 from invoices where job_card_id = p_job_id) then
    raise exception 'This job has an invoice — labour & parts are locked.';
  end if;

  if p_sell_price is not null then
    v_price := round(p_sell_price, 2);
  else
    select coalesce(parts_markup_percent, 30) into v_markup from shop_settings limit 1;
    v_markup := coalesce(v_markup, 30);
    v_price  := round(p_cost * (1 + v_markup / 100.0), 2);
  end if;

  insert into job_line_items (job_card_id, kind, description, quantity, unit_price, cost_price, supplier_id, supplier_ref)
    values (p_job_id, 'part', left(btrim(p_description), 200), p_qty, v_price, round(p_cost, 2),
            p_supplier_id, nullif(left(btrim(p_supplier_ref), 100), ''))
    returning * into v_row;

  return v_row;
end;
$$;

-- The 6-argument version from 0053 is superseded.
drop function if exists public.add_ordered_part_to_job(uuid, text, numeric, numeric, uuid, text);

revoke execute on function public.add_ordered_part_to_job(uuid, text, numeric, numeric, uuid, text, numeric) from public, anon;
grant  execute on function public.add_ordered_part_to_job(uuid, text, numeric, numeric, uuid, text, numeric) to authenticated;
