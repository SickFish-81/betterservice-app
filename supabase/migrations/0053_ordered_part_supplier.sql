-- ============================================================================
-- Betterservice ATV — who a job's ordered-in part came from (31 Aug 2026)
--
-- When a part is ordered in for a job, the supplier's own invoice turns up
-- separately, days later, in a pile with everyone else's. Recording who it came
-- from — and their docket or invoice number if it's to hand — is what makes the
-- two findable from each other later.
--
-- Both are optional: a part with no supplier recorded still goes on the job.
-- Better a slightly thin record than a mechanic blocked at the counter.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.job_line_items
  add column if not exists supplier_id  uuid references public.suppliers(id),
  add column if not exists supplier_ref text;

create index if not exists job_line_items_supplier_idx
  on public.job_line_items (supplier_id) where supplier_id is not null;

create or replace function public.add_ordered_part_to_job(
  p_job_id       uuid,
  p_description  text,
  p_qty          numeric,
  p_cost         numeric,
  p_supplier_id  uuid default null,
  p_supplier_ref text default null
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
  if exists (select 1 from invoices where job_card_id = p_job_id) then
    raise exception 'This job has an invoice — labour & parts are locked.';
  end if;

  select coalesce(parts_markup_percent, 30) into v_markup from shop_settings limit 1;
  v_markup := coalesce(v_markup, 30);
  v_price  := round(p_cost * (1 + v_markup / 100.0), 2);

  insert into job_line_items (job_card_id, kind, description, quantity, unit_price, cost_price, supplier_id, supplier_ref)
    values (p_job_id, 'part', left(btrim(p_description), 200), p_qty, v_price, round(p_cost, 2),
            p_supplier_id, nullif(left(btrim(p_supplier_ref), 100), ''))
    returning * into v_row;

  return v_row;
end;
$$;

-- The 4-argument version from 0050 is superseded.
drop function if exists public.add_ordered_part_to_job(uuid, text, numeric, numeric);

revoke execute on function public.add_ordered_part_to_job(uuid, text, numeric, numeric, uuid, text) from public, anon;
grant  execute on function public.add_ordered_part_to_job(uuid, text, numeric, numeric, uuid, text) to authenticated;
