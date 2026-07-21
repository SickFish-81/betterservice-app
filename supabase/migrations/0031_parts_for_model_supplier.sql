-- ============================================================================
-- Betterservice Te Puke — supplier on the per-model parts view (21 July 2026)
-- Adds the reorder contact to parts_for_model(): each stocked part's supplier
-- (parts.supplier_id -> suppliers) and their phone number, so the "parts used on
-- this make + model" list doubles as a reorder sheet.
-- Return signature changes, so drop first (create-or-replace can't add columns).
-- ============================================================================

drop function if exists public.parts_for_model(text, text);

create or replace function public.parts_for_model(p_make text, p_model text)
returns table(
  part_id text,
  description text,
  times_used bigint,
  total_qty numeric,
  last_used timestamptz,
  supplier text,
  supplier_phone text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.part_id::text,
         u.description,
         count(*)::bigint as times_used,
         sum(u.quantity)  as total_qty,
         max(u.used_at)   as last_used,
         sup.name         as supplier,
         sup.phone        as supplier_phone
  from public.model_part_usage u
  left join public.parts p       on p.id = u.part_id
  left join public.suppliers sup on sup.id = p.supplier_id
  where is_approved_staff()
    and (p_make  is null or lower(u.make)  = lower(p_make))
    and (p_model is null or lower(u.model) = lower(p_model))
  group by u.part_id, u.description, sup.name, sup.phone
  order by count(*) desc, max(u.used_at) desc;
$function$;

revoke execute on function public.parts_for_model(text, text) from public, anon;
grant  execute on function public.parts_for_model(text, text) to authenticated;
