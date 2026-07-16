-- ============================================================================
-- Betterservice Te Puke — time tracking on job cards (job costing)
-- Built 16 July 2026. Records ACTUAL time worked per staff member on a job
-- (live clock on/off or manually entered hours), separate from the billed
-- labour line. Logged time can be pushed to a labour line item from the job
-- card (billed flag), so job costing and labour billing stay in sync.
-- ============================================================================

create table if not exists public.job_time_entries (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid not null references public.job_cards(id) on delete cascade,
  staff_id    uuid references public.staff(id) on delete set null,
  started_at  timestamptz,   -- set when a live timer is clocked on
  ended_at    timestamptz,   -- set when clocked off
  hours       numeric(6,2),  -- worked hours; null while a timer is still running
  note        text,
  billed      boolean not null default false,  -- pushed to a labour line item?
  created_at  timestamptz not null default now()
);

alter table public.job_time_entries enable row level security;

create policy staff_all on public.job_time_entries
  for all using (is_approved_staff()) with check (is_approved_staff());

create index if not exists job_time_entries_job_idx
  on public.job_time_entries(job_card_id);
