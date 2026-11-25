-- Stock: take a machine back out of stock (26 Nov 2026).
--
-- Craig, email "Removing bike", 26 Nov: "how do I remove this bike, i bought it
-- then changed my mind". Until now nothing could be deleted from Stock: a
-- machine left by being Sold (migration 0092). Ben promised Craig a remove
-- button with an "are you sure" step.
--
-- remove_stock_item() takes the row out of stock, owners only (Craig and Ben),
-- because it can't be undone. It also deletes the machine record when the
-- machine has never been in the workshop: a machine added only to be stock has
-- nothing else hanging off it. One with jobs keeps its record and history.
--
-- It refuses:
--   * a Sold row: the bike belongs to the buyer now and the sale is a record.
--   * a row on the website: take it off the For Sale page first, so a listing
--     is never left pointing at nothing.

create or replace function public.remove_stock_item(p_stock_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row stock_items;
begin
  if not is_owner() then raise exception 'Only Craig or Ben can remove a machine from stock.'; end if;

  select * into v_row from stock_items where id = p_stock_id for update;
  if not found then raise exception 'That machine is no longer in stock.'; end if;
  if v_row.stage = 'Sold' then raise exception 'A sold machine stays on the list as the record of the sale.'; end if;
  if v_row.listing_id is not null and exists (select 1 from secondhand_listings where id = v_row.listing_id) then
    raise exception 'It''s on the website. Remove it from the For Sale page first, then remove it here.';
  end if;

  delete from stock_items where id = p_stock_id;

  if not exists (select 1 from job_cards where machine_id = v_row.machine_id)
     and not exists (select 1 from stock_items where machine_id = v_row.machine_id) then
    delete from machines where id = v_row.machine_id;
    return 'machine_deleted';
  end if;
  return 'kept_machine';
end;
$function$;

revoke execute on function public.remove_stock_item(uuid) from public, anon;
grant  execute on function public.remove_stock_item(uuid) to authenticated;

-- The B79 duplicate Craig added on 24 Nov (Ben approved removing it then). It
-- has no jobs and no stock row; the real B79 is the one with job #159.
delete from public.machines m
 where m.id = 'ecd4aad9-5f9c-4270-9cdb-20430b101466'
   and not exists (select 1 from public.job_cards j where j.machine_id = m.id)
   and not exists (select 1 from public.stock_items s where s.machine_id = m.id);
