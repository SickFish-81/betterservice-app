-- ============================================================================
-- Betterservice Te Puke — job line-item integrity (21 July 2026)
-- Addresses the two High-Priority findings in CODE_REVIEW.md:
--   #4  Stock counts can drift when two staff touch the same part at once,
--       because the app read qty_on_hand into the browser, did the maths, and
--       wrote it back (a "read-then-write" race). Fixed by doing the add/remove
--       and the stock adjustment together, in the database, with a row lock.
--   #5  "Labour & parts are locked once invoiced" was only enforced in the UI.
--       A trigger now enforces it in the database, so a stray browser request
--       can't quietly change a job's line items after it has been invoiced.
--
-- Safe with job deletion: the app deletes a job's invoice BEFORE the job card,
-- and invoices -> job_cards is ON DELETE NO ACTION, so by the time line items
-- are cascade-deleted no invoice exists and the lock trigger allows it.
-- Idempotent: create-or-replace + drop-if-exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Lock trigger: block writes to job_line_items once the job has an invoice.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_job_line_items_not_invoiced()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job uuid := coalesce(new.job_card_id, old.job_card_id);
begin
  if exists (select 1 from invoices where job_card_id = v_job) then
    raise exception 'This job has an invoice — labour & parts are locked. Discard the invoice first.';
  end if;
  return coalesce(new, old);
end;
$function$;

drop trigger if exists trg_job_line_items_lock on public.job_line_items;
create trigger trg_job_line_items_lock
  before insert or update or delete on public.job_line_items
  for each row execute function public.enforce_job_line_items_not_invoiced();

-- ----------------------------------------------------------------------------
-- Atomic: add a stocked part to a job AND draw it down from inventory.
-- Row-locks the part so concurrent adds/removes can't clobber the count.
-- ----------------------------------------------------------------------------
create or replace function public.add_part_to_job(p_job_id uuid, p_part_id uuid, p_qty numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_part public.parts;
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  select * into v_part from public.parts where id = p_part_id for update;
  if not found then
    raise exception 'Part not found';
  end if;

  insert into public.job_line_items (job_card_id, kind, part_id, description, quantity, unit_price)
    values (p_job_id, 'part', v_part.id, v_part.name, p_qty, v_part.unit_price);

  update public.parts set qty_on_hand = qty_on_hand - p_qty where id = v_part.id;
end;
$function$;

-- ----------------------------------------------------------------------------
-- Atomic: remove a job line item AND put stock back if it was a stocked part.
-- ----------------------------------------------------------------------------
create or replace function public.remove_job_line_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item public.job_line_items;
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;

  select * into v_item from public.job_line_items where id = p_item_id;
  if not found then
    return;
  end if;

  delete from public.job_line_items where id = p_item_id;

  if v_item.kind = 'part' and v_item.part_id is not null then
    update public.parts set qty_on_hand = qty_on_hand + v_item.quantity where id = v_item.part_id;
  end if;
end;
$function$;

-- Lock down execute: staff only (the internal guard also blocks non-staff).
revoke execute on function public.add_part_to_job(uuid, uuid, numeric) from public, anon;
grant  execute on function public.add_part_to_job(uuid, uuid, numeric) to authenticated;
revoke execute on function public.remove_job_line_item(uuid) from public, anon;
grant  execute on function public.remove_job_line_item(uuid) to authenticated;
