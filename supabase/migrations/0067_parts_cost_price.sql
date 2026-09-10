-- 0067_parts_cost_price.sql
--
-- Records a column that is ALREADY in production but exists in no migration.
--
-- parts.cost_price is live (numeric not null default 0) but the schema baseline
-- doesn't have it and no migration adds it, so it was created by hand in the
-- SQL editor at some point. A database rebuilt from these files would not have
-- had it, and anything reading it would have broken. This file closes that gap.
--
-- Safe to run against production: add column if not exists changes nothing
-- where the column is already there.
--
-- Not to be confused with job_line_items.cost_price (migration 0050), which is
-- a different column for a different job: what a one-off ordered-in part cost
-- on a specific job card. THIS one is what the shop pays its supplier for a
-- part it stocks, so the margin on counter sales and job parts is answerable.
--
-- All 16 existing parts sit at 0 because nothing has ever been able to set it —
-- there was no box on the Parts page. That box exists as of this change, so the
-- figures get filled in as Craig goes.

alter table public.parts
  add column if not exists cost_price numeric not null default 0;

-- A negative cost is always a typo, and a cost is not optional in the way a
-- sale price is: unset simply means zero, which reads as "not entered yet".
alter table public.parts drop constraint if exists parts_cost_price_sane;
alter table public.parts add constraint parts_cost_price_sane
  check (cost_price >= 0);

comment on column public.parts.cost_price is
  'What the shop pays the supplier for one of these. Never shown to a customer; '
  'used to work out the margin against unit_price. 0 means not entered yet.';

comment on column public.parts.unit_price is
  'What the customer is charged for one of these. The sale price.';
