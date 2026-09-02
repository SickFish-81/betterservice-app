-- Service reminders go out by email, not text.
--
-- The nightly job has been calling Twilio since it was written, and Twilio was
-- never set up — so every night it woke up, answered "Twilio isn't set up yet"
-- and went back to sleep. It returned HTTP 200 doing it, so nothing ever
-- flagged it: a year of service reminders that were never sent, quietly.
--
-- SMS isn't happening for now, and the shop already sends reminders by email
-- from the customer page using the template in Settings. This is the same list,
-- picked by email instead of phone, so the nightly job and the button send the
-- same message.
--
-- due_for_sms_reminder() is left in place. Nothing calls it now, but it costs
-- nothing to keep and it's the starting point if texting is ever turned on.

create or replace function public.due_for_email_reminder(p_limit integer default 5)
returns table(machine_id uuid, customer_id uuid, customer_name text, email text, machine_label text, months integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.id, c.id, c.name, c.email,
         btrim(concat_ws(' ', m.type, m.make, m.model)) as machine_label,
         (extract(year from age(now(), m.last_service_date)) * 12
          + extract(month from age(now(), m.last_service_date)))::int as months
  from machines m
  join customers c on c.id = m.customer_id
  where (
          public.is_approved_staff()
          or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
        )
    and m.last_service_date is not null
    and coalesce(c.no_reminders, false) = false
    and coalesce(c.email, '') <> ''
    -- Not chased again until they've actually been back in.
    and (m.last_reminder_sent is null or m.last_reminder_sent < m.last_service_date)
    -- Due, but not so long ago they've clearly gone elsewhere.
    and age(now(), m.last_service_date) >= interval '12 months'
    and age(now(), m.last_service_date) <= interval '18 months'
  order by m.last_service_date asc
  limit greatest(coalesce(p_limit, 5), 0);
$function$;

revoke all on function public.due_for_email_reminder(integer) from public, anon;
grant execute on function public.due_for_email_reminder(integer) to authenticated, service_role;

comment on function public.due_for_email_reminder(integer) is
  'Machines due for a service whose owner has an email address and has not opted out. Used by the nightly send-due-reminders job.';
