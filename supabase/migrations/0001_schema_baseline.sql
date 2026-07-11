-- ============================================================================
-- Betterservice Tepuke — schema baseline
-- Captured from the live Supabase project (vdwssiefdhmepdgkuoxd) on 2026-07-09.
-- Run this on an EMPTY database to reproduce the full schema, RLS and policies.
-- It already reflects the 9 July launch-readiness hardening (see 0002).
-- ============================================================================

-- ---------- Tables (no foreign keys) ----------
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  email        text,
  address      text,
  notes        text,
  no_reminders boolean default false,
  created_at   timestamptz default now()
);

create table if not exists public.staff (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  role              text default 'staff',
  can_send_invoices boolean default false,
  email             text,
  active            boolean default true,
  created_at        timestamptz default now()
);

create table if not exists public.parts (
  id          uuid primary key default gen_random_uuid(),
  sku         text,
  name        text not null,
  description text,
  unit_price  numeric default 0,
  qty_on_hand integer default 0,
  min_stock   integer default 0,
  created_at  timestamptz default now()
);

create table if not exists public.checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  items      text[] not null default '{}'::text[],
  created_at timestamptz default now()
);

create table if not exists public.shop_settings (
  id           integer primary key default 1,
  business_name text,
  address      text,
  phone        text,
  gst_number   text,
  bank_account text,
  updated_at   timestamptz default now()
);

create table if not exists public.secondhand_listings (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  price       numeric default 0,
  status      text default 'Available',
  created_at  timestamptz default now()
);

-- ---------- Tables (with foreign keys) ----------
create table if not exists public.machines (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid references public.customers(id) on delete no action,
  type               text,
  make               text,
  model              text,
  year               integer,
  rego               text,
  odometer           integer,
  vin                text,
  last_service_date  date,
  notes              text,
  last_reminder_sent timestamptz,
  created_at         timestamptz default now()
);

create table if not exists public.job_cards (
  id               uuid primary key default gen_random_uuid(),
  job_number       bigint not null,               -- assigned by the app (max + 1)
  customer_id      uuid references public.customers(id) on delete no action,
  machine_id       uuid references public.machines(id)  on delete no action,
  status           text not null default 'New',
  source           text default 'Phone',
  reported_problem text,
  assigned_to      text default 'Craig',
  promised_date    date,
  completed_date   date,
  notes            text,
  job_date         date not null default ((now() at time zone 'Pacific/Auckland'))::date,
  picked_up_by     uuid references public.staff(id) on delete no action,
  serviced_by      uuid references public.staff(id) on delete no action,
  dropped_off_by   uuid references public.staff(id) on delete no action,
  created_at       timestamptz default now()
);

create table if not exists public.job_line_items (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid references public.job_cards(id) on delete cascade,
  kind        text not null,                       -- 'labour' | 'part'
  description text,
  part_id     uuid references public.parts(id) on delete no action,
  quantity    numeric default 1,
  unit_price  numeric default 115,
  amount      numeric generated always as (quantity * unit_price) stored,
  created_at  timestamptz default now()
);

create table if not exists public.job_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid references public.job_cards(id) on delete cascade,
  label       text not null,
  done        boolean default false,
  position    integer default 0,
  created_at  timestamptz default now()
);

create table if not exists public.job_photos (
  id          uuid primary key default gen_random_uuid(),
  job_card_id uuid references public.job_cards(id) on delete cascade,
  url         text not null,
  path        text,
  created_at  timestamptz default now()
);

create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number bigint not null,                  -- assigned by the app (max + 1)
  job_card_id    uuid references public.job_cards(id) on delete no action,
  subtotal       numeric default 0,
  gst            numeric default 0,
  total          numeric default 0,
  status         text default 'Unpaid',
  payment_method text,
  issued_date    date default current_date,
  paid_date      date,
  approved_by    uuid references public.staff(id) on delete no action,
  sent           boolean default false,
  sent_by        uuid references public.staff(id) on delete no action,
  sent_at        timestamptz,
  pdf_url        text,                             -- stores the private storage PATH (see 0002)
  pdf_backup_url text,
  created_at     timestamptz default now()
);

create table if not exists public.secondhand_photos (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid references public.secondhand_listings(id) on delete cascade,
  url        text not null,
  path       text,
  created_at timestamptz default now()
);

-- ---------- Security-definer helper functions ----------
create or replace function public.is_approved_staff()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from staff where lower(email) = lower(auth.email()) and coalesce(active, true)); $$;

create or replace function public.is_owner()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from staff where lower(email) = lower(auth.email()) and role = 'owner' and coalesce(active, true)); $$;

create or replace function public.current_staff_can_send()
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce((select can_send_invoices from staff where lower(email) = lower(auth.email())), false); $$;

revoke execute on function public.is_approved_staff()      from public;
revoke execute on function public.is_owner()               from public;
revoke execute on function public.current_staff_can_send() from public;
grant  execute on function public.is_approved_staff()      to authenticated;
grant  execute on function public.is_owner()               to authenticated;
grant  execute on function public.current_staff_can_send() to authenticated;

-- ---------- Row-level security ----------
alter table public.customers            enable row level security;
alter table public.staff                enable row level security;
alter table public.parts                enable row level security;
alter table public.checklist_templates  enable row level security;
alter table public.shop_settings        enable row level security;
alter table public.secondhand_listings  enable row level security;
alter table public.machines             enable row level security;
alter table public.job_cards            enable row level security;
alter table public.job_line_items       enable row level security;
alter table public.job_checklist_items  enable row level security;
alter table public.job_photos           enable row level security;
alter table public.invoices             enable row level security;
alter table public.secondhand_photos    enable row level security;

-- Approved staff can do everything on the operational tables.
drop policy if exists staff_all on public.customers;
create policy staff_all on public.customers           for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.machines;
create policy staff_all on public.machines            for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.job_cards;
create policy staff_all on public.job_cards           for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.job_line_items;
create policy staff_all on public.job_line_items      for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.job_checklist_items;
create policy staff_all on public.job_checklist_items for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.job_photos;
create policy staff_all on public.job_photos          for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.parts;
create policy staff_all on public.parts               for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists staff_all on public.checklist_templates;
create policy staff_all on public.checklist_templates for all to authenticated using (is_approved_staff()) with check (is_approved_staff());

-- Invoices: staff read/insert/delete; once sent, only a can-send owner may update.
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select to authenticated using (is_approved_staff());
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated with check (is_approved_staff());
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices for delete to authenticated using (is_approved_staff());
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (is_approved_staff())
  with check (is_approved_staff() and ((sent = false) or current_staff_can_send()));

-- Shop settings: staff read, owner-only write.
drop policy if exists settings_read on public.shop_settings;
create policy settings_read  on public.shop_settings for select to authenticated using (is_approved_staff());
drop policy if exists settings_write on public.shop_settings;
create policy settings_write on public.shop_settings for update to authenticated using (is_owner()) with check (is_owner());

-- Staff table: staff read, owner-only add/edit/remove.
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated using (is_approved_staff());
drop policy if exists staff_insert on public.staff;
create policy staff_insert on public.staff for insert to authenticated with check (is_owner());
drop policy if exists staff_update on public.staff;
create policy staff_update on public.staff for update to authenticated using (is_owner()) with check (is_owner());
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff for delete to authenticated using (is_owner());

-- Secondhand listings/photos: public can read available listings; staff manage.
drop policy if exists public_read on public.secondhand_listings;
create policy public_read on public.secondhand_listings for select to anon using (status = 'Available');
drop policy if exists staff_all on public.secondhand_listings;
create policy staff_all on public.secondhand_listings for all to authenticated using (is_approved_staff()) with check (is_approved_staff());
drop policy if exists public_read on public.secondhand_photos;
create policy public_read on public.secondhand_photos for select to anon using (true);
drop policy if exists staff_all on public.secondhand_photos;
create policy staff_all on public.secondhand_photos for all to authenticated using (is_approved_staff()) with check (is_approved_staff());

-- ---------- Storage buckets ----------
insert into storage.buckets (id, name, public) values
  ('invoices',       'invoices',       false),   -- private: signed-URL access only (see 0002)
  ('job-photos',     'job-photos',     true),
  ('listing-photos', 'listing-photos', true)
on conflict (id) do update set public = excluded.public;

-- Invoices bucket: authenticated staff can read (mint signed URLs) and write/manage.
drop policy if exists invoices_read on storage.objects;
create policy invoices_read   on storage.objects for select to authenticated using (bucket_id = 'invoices');
drop policy if exists invoices_write on storage.objects;
create policy invoices_write  on storage.objects for insert to authenticated with check (bucket_id = 'invoices');
drop policy if exists invoices_update on storage.objects;
create policy invoices_update on storage.objects for update to authenticated using (bucket_id = 'invoices') with check (bucket_id = 'invoices');
drop policy if exists invoices_delete on storage.objects;
create policy invoices_delete on storage.objects for delete to authenticated using (bucket_id = 'invoices');

-- Public photo buckets: staff can write/delete (reads are public via the bucket).
drop policy if exists jobphotos_write on storage.objects;
create policy jobphotos_write     on storage.objects for insert to authenticated with check (bucket_id = 'job-photos');
drop policy if exists jobphotos_delete on storage.objects;
create policy jobphotos_delete    on storage.objects for delete to authenticated using (bucket_id = 'job-photos');
drop policy if exists listingphotos_write on storage.objects;
create policy listingphotos_write  on storage.objects for insert to authenticated with check (bucket_id = 'listing-photos');
drop policy if exists listingphotos_delete on storage.objects;
create policy listingphotos_delete on storage.objects for delete to authenticated using (bucket_id = 'listing-photos');
