-- Dispatch that does not depend on email.
--
-- WHY THIS EXISTS
-- A pick-up dispatch has had exactly two ways to reach someone: a web push,
-- which needs them to have pressed "Turn on notifications" on their own phone,
-- and an email. Craig, Bjorn and Peni have done neither, and two of the three
-- have no working email address — bjorn@ and peni@ were never created in
-- Fastmail, so mail to them is rejected outright. Job #70 was dispatched to
-- Bjorn on 11 Oct and hard-bounced.
--
-- Worse, nothing recorded that the dispatch happened at all. The only trace
-- was a row in email_log, so a dispatch to someone with no email address left
-- no record anywhere. The job said "picked up by Bjorn" and Bjorn had never
-- been told.
--
-- So the dispatch itself becomes the record, written BEFORE either delivery
-- channel is attempted. Push and email become ways of drawing attention to a
-- notification that already exists, rather than being the notification. A
-- person with no phone set up and no email address still gets dispatched —
-- they see it when they open the app, which they do anyway to work the job.
--
-- NOT built on email_log on purpose. That table is about what Resend was asked
-- to send and what became of it; it is keyed by address, and the people this
-- is for are exactly the ones with no address.

create table if not exists public.staff_notifications (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null default 'pickup_dispatch',
  title       text not null,
  body        text,
  url         text,
  address     text,
  job_id      uuid references public.job_cards(id) on delete set null,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff(id),
  read_at     timestamptz
);

comment on table public.staff_notifications is
  'What the app has told a staff member. Written before push or email is tried, so a dispatch survives both failing.';
comment on column public.staff_notifications.read_at is
  'Null until they open it. The dashboard badge counts nulls.';

-- The two questions the app asks: "what is unread for me" and "show me my
-- list". One partial index for the badge, one for the page.
create index if not exists staff_notifications_unread_idx
  on public.staff_notifications (staff_id, created_at desc)
  where read_at is null;

create index if not exists staff_notifications_mine_idx
  on public.staff_notifications (staff_id, created_at desc);

-- ---------------------------------------------------------------- access
--
-- Yours and only yours. Not owner-wide: a notification is addressed to one
-- person, and Craig seeing Bjorn's list adds nothing he cannot get from the
-- job card itself.
--
-- current_staff_id() already handles the user_id-then-email fallback, which
-- matters here because the people this is built for have no email address.

alter table public.staff_notifications enable row level security;

drop policy if exists staff_notifications_read_own on public.staff_notifications;
create policy staff_notifications_read_own
  on public.staff_notifications for select
  to authenticated
  using (staff_id = public.current_staff_id());

drop policy if exists staff_notifications_mark_own_read on public.staff_notifications;
create policy staff_notifications_mark_own_read
  on public.staff_notifications for update
  to authenticated
  using (staff_id = public.current_staff_id())
  with check (staff_id = public.current_staff_id());

-- Nobody writes notifications from the browser. send-dispatch does it with the
-- service role, so there is no insert policy at all and RLS denies it.
--
-- `from public, anon` rather than `from anon, authenticated`: revoking from
-- anon alone leaves the default grant to PUBLIC intact and changes nothing,
-- silently. That mistake made migration 0076's first attempt a no-op.
revoke all on public.staff_notifications from public, anon, authenticated;
grant select           on public.staff_notifications to authenticated;
grant update (read_at) on public.staff_notifications to authenticated;

-- ---------------------------------------------------------------- checks
do $$
begin
  if has_table_privilege('anon', 'public.staff_notifications', 'SELECT') then
    raise exception 'anon can read staff notifications';
  end if;
  if has_column_privilege('authenticated', 'public.staff_notifications', 'title', 'UPDATE') then
    raise exception 'a signed-in user can rewrite the text of their own notifications';
  end if;
  if not has_column_privilege('authenticated', 'public.staff_notifications', 'read_at', 'UPDATE') then
    raise exception 'nobody can mark a notification read';
  end if;
  if has_table_privilege('authenticated', 'public.staff_notifications', 'INSERT') then
    raise exception 'the browser can invent notifications';
  end if;
  if not has_table_privilege('service_role', 'public.staff_notifications', 'INSERT') then
    raise exception 'send-dispatch cannot record a dispatch';
  end if;
end $$;
