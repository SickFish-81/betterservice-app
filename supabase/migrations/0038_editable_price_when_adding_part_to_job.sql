-- ============================================================================
-- Betterservice Te Puke — editable price when adding a part to a job (26 Aug 2026)
--
-- Why: add_part_to_job() always billed parts.unit_price, with no way to override
-- it on the job. Real jobs need a one-off price — welding, a part bought in at a
-- different cost, a price agreed with the customer. Without it, staff were
-- creating DUPLICATE parts just to get the right price onto a job, which left
-- the inventory list full of near-identical entries at wrong prices.
--
-- What changes: an optional p_unit_price. Omit it (or pass null) and behaviour is
-- exactly as before — the part's own price is used. Pass a value and that price
-- is billed on this job only; the inventory record is untouched.
--
-- The old 3-argument function is dropped first so the new one isn't an ambiguous
-- overload. Because the 4th argument has a default, existing 3-argument calls
-- keep working unchanged — no window where the app breaks.
-- ============================================================================

drop function if exists public.add_part_to_job(uuid, uuid, numeric);

create or replace function public.add_part_to_job(
  p_job_id     uuid,
  p_part_id    uuid,
  p_qty        numeric,
  p_unit_price numeric default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_part  public.parts;
  v_price numeric(12,2);
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if p_unit_price is not null and p_unit_price < 0 then
    raise exception 'Price cannot be negative';
  end if;

  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'Part not found';
  end if;

  -- Override if given, otherwise the part's own price. Rounded to 2dp to match
  -- the money constraints every other table carries.
  v_price := round(coalesce(p_unit_price, v_part.unit_price), 2);

  insert into public.job_line_items (job_card_id, kind, part_id, description, quantity, unit_price)
    values (p_job_id, 'part', v_part.id, v_part.name, p_qty, v_price);

  -- Stock still moves by quantity regardless of what it was billed at.
  update public.parts set qty_on_hand = qty_on_hand - p_qty where id = v_part.id;
end;
$function$;

revoke execute on function public.add_part_to_job(uuid, uuid, numeric, numeric) from public, anon;
grant  execute on function public.add_part_to_job(uuid, uuid, numeric, numeric) to authenticated;
