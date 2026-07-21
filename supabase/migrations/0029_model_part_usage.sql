-- ============================================================================
-- Betterservice Te Puke — per-model parts history (21 July 2026)
-- Automatically records which parts get used on each machine make + model, so
-- the shop slowly builds up a "parts commonly used on <Make Model>" list (and,
-- via each part's supplier, who to buy them from).
--
-- How it works: an AFTER INSERT trigger on job_line_items captures every part
-- added to a job, stamped with that job's machine make + model. It's wrapped in
-- an exception guard so a logging hiccup can NEVER block adding a part to a job.
-- Append-only (removing a part later doesn't un-log it) — fine for a build-up list.
-- ============================================================================

create table if not exists public.model_part_usage (
  id          uuid primary key default gen_random_uuid(),
  make        text,
  model       text,
  part_id     uuid references public.parts(id)      on delete set null,
  description text,
  quantity    numeric not null default 1,
  job_card_id uuid references public.job_cards(id)  on delete set null,
  used_at     timestamptz not null default now()
);

create index if not exists idx_model_part_usage_make_model
  on public.model_part_usage (lower(make), lower(model));

alter table public.model_part_usage enable row level security;
drop policy if exists staff_all on public.model_part_usage;
create policy staff_all on public.model_part_usage
  for all to authenticated using (is_approved_staff()) with check (is_approved_staff());

-- Capture trigger: log the part against the job's machine make + model.
create or replace function public.log_model_part_usage()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_make  text;
  v_model text;
begin
  if new.kind = 'part' then
    begin
      select mm.make, mm.model into v_make, v_model
      from public.job_cards jc
      join public.machines mm on mm.id = jc.machine_id
      where jc.id = new.job_card_id;

      if coalesce(v_make, v_model) is not null then
        insert into public.model_part_usage (make, model, part_id, description, quantity, job_card_id)
          values (v_make, v_model, new.part_id, new.description, coalesce(new.quantity, 1), new.job_card_id);
      end if;
    exception when others then
      null;  -- logging must never break adding a part
    end;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_log_model_part_usage on public.job_line_items;
create trigger trg_log_model_part_usage
  after insert on public.job_line_items
  for each row execute function public.log_model_part_usage();

-- Aggregated read: parts commonly used on a given make + model.
create or replace function public.parts_for_model(p_make text, p_model text)
returns table(part_id uuid, description text, times_used bigint, total_qty numeric, last_used timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.part_id,
         u.description,
         count(*)::bigint as times_used,
         sum(u.quantity)  as total_qty,
         max(u.used_at)   as last_used
  from public.model_part_usage u
  where is_approved_staff()
    and (p_make  is null or lower(u.make)  = lower(p_make))
    and (p_model is null or lower(u.model) = lower(p_model))
  group by u.part_id, u.description
  order by count(*) desc, max(u.used_at) desc;
$function$;

revoke execute on function public.parts_for_model(text, text) from public, anon;
grant  execute on function public.parts_for_model(text, text) to authenticated;
