-- ============================================================================
-- Betterservice ATV — push notifications to a phone (17 Sep 2026)
--
-- Replaces the texting that was never switched on. Craig's report was "it isn't
-- texting me"; the honest answer was that SMS in New Zealand means a telco
-- account, business verification and a monthly bill, for a handful of pick-up
-- messages a month. A web push notification costs nothing, needs no provider,
-- and lands on the phone the same way a text does.
--
-- One row per DEVICE, not per person: Craig with a phone and a tablet has two,
-- and each has its own endpoint and its own pair of keys. A person who clears
-- their browser data, reinstalls, or changes phone gets a new row; the old one
-- goes stale and is deleted by the sender when the push service rejects it with
-- a 404 or 410, which is the only reliable way to know a subscription is dead.
--
-- The keys here are NOT secrets in the usual sense — they are the browser's own
-- public encryption keys for that one device, useless without the endpoint, and
-- they cannot be used to read anything. The VAPID private key, which signs the
-- pushes, lives only in the Supabase secrets.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  -- The push service's URL for this device. Unique because re-subscribing on the
  -- same device returns the same endpoint, and a duplicate would mean the person
  -- gets every notification twice.
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);

create index if not exists push_subscriptions_staff_idx on public.push_subscriptions (staff_id);

alter table public.push_subscriptions enable row level security;

-- A person manages their own devices and nobody else's. Reading someone else's
-- endpoint would let you send them push notifications from outside the app.
drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions
  for select to authenticated using (staff_id = current_staff_id());

drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions
  for insert to authenticated with check (staff_id = current_staff_id());

drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions
  for delete to authenticated using (staff_id = current_staff_id());

-- Craig needs to see WHO has notifications switched on, so he can tell before
-- dispatching whether the person will actually hear about it.
--
-- This view is deliberately NOT security_invoker. The policies above stop a
-- person reading anyone else's subscription row, which is right — an endpoint
-- plus its keys is enough to push to that device. But it would also make this
-- count read zero for everyone but yourself, which is useless. Running as the
-- view's owner exposes a COUNT and a name, and nothing that could be used to
-- send anything.
create or replace view public.staff_push_status as
  select s.id as staff_id, s.name,
         (select count(*) from public.push_subscriptions p where p.staff_id = s.id) as devices
  from public.staff s
  where coalesce(s.active, true);
