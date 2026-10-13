-- Let people clear a notification off their own list.
--
-- HIDDEN, NOT DESTROYED, and the distinction is the entire reason this table
-- exists. Job #70 was dispatched to Bjorn, bounced, and left no trace — "was
-- he actually told?" had no answer anywhere. A hard delete would hand that
-- hole straight back, one row at a time, and the person with the most reason
-- to clear a dispatch is the person who would rather it had not been recorded.
--
-- So clearing is a stamp, not a DELETE. To the person it is gone for good —
-- off their list, out of the badge, no undo offered. The row stays for the
-- record. There is no delete grant on this table at all, so the browser
-- cannot destroy one even if it asks.

alter table public.staff_notifications
  add column if not exists dismissed_at timestamptz;

comment on column public.staff_notifications.dismissed_at is
  'When they cleared it off their list. The row stays: it is the record that they were dispatched.';

-- Widen the column grant by exactly one column. Still no insert, still no
-- delete, and still nothing that lets anyone edit what a notification SAYS.
grant update (read_at, dismissed_at) on public.staff_notifications to authenticated;

-- NOT reindexed, deliberately. The two partial indexes from 0078 still index
-- on (staff_id, created_at) and the queries now also filter dismissed_at, so
-- they are a shade less selective than they could be. On a table that holds
-- one row per pick-up that is noise, and rebuilding them is the kind of
-- tidying that costs a lock for no measurable gain. Revisit if this ever
-- holds tens of thousands of rows, which at Betterservice's dispatch rate is
-- several lifetimes away.

do $$
begin
  if not has_column_privilege('authenticated', 'public.staff_notifications', 'dismissed_at', 'UPDATE') then
    raise exception 'nobody can clear a notification';
  end if;
  if has_table_privilege('authenticated', 'public.staff_notifications', 'DELETE') then
    raise exception 'a notification can be destroyed from the browser';
  end if;
  if has_column_privilege('authenticated', 'public.staff_notifications', 'title', 'UPDATE') then
    raise exception 'a notification can be reworded from the browser';
  end if;
end $$;
