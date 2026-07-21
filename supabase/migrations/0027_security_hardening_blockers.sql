-- ============================================================================
-- Betterservice Te Puke — security hardening (21 July 2026)
-- Closes three data-exposure gaps found in the code review (CODE_REVIEW.md):
--   1. outstanding_statements()  — was callable by anyone; leaked customer
--      names/emails/unpaid-invoice detail.
--   2. due_for_sms_reminder()    — was callable by anyone (even with no login);
--      leaked customer names + phone numbers.
--   3. Storage policies          — the private `invoices` bucket (and the photo
--      buckets' writes) only checked "logged in", not "is staff".
--
-- Design note: both functions are called by scheduled Edge Functions
-- (send-statements, send-due-reminders) using the SERVICE ROLE key. So the guard
-- must allow (a) the service role, plus (b) owners/staff — while blocking anon
-- and ordinary logged-in users. We detect the service role from the request JWT
-- claims (which are set per-request and are NOT masked by SECURITY DEFINER).
--
-- Idempotent: create-or-replace + drop-policy-if-exists, safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. outstanding_statements(): owners (or the service-role cron) only.
--    Converted from `language sql` to `plpgsql` so we can guard before querying,
--    matching accounting_overview() / financial_report() / balance_sheet().
-- ----------------------------------------------------------------------------
create or replace function public.outstanding_statements()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Allow owners, or the trusted server-side cron (service_role). Block everyone else.
  if not (
       public.is_owner()
       or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
     ) then
    raise exception 'Not authorized: owners only';
  end if;

  return (
    select coalesce(jsonb_agg(c order by (c->>'customer_name')), '[]'::jsonb) from (
      select jsonb_build_object(
        'customer_name', cu.name,
        'email', cu.email,
        'total_owing', sum(i.total - coalesce(p.paid,0)),
        'invoices', jsonb_agg(jsonb_build_object(
           'number', i.invoice_number,
           'date',   i.issued_date,
           'total',  i.total,
           'paid',   coalesce(p.paid,0),
           'balance', i.total - coalesce(p.paid,0)
        ) order by i.invoice_number)
      ) as c
      from invoices i
      join job_cards j  on j.id = i.job_card_id
      join customers cu on cu.id = j.customer_id
      left join (select invoice_id, sum(amount) paid from payments group by invoice_id) p on p.invoice_id = i.id
      where i.status in ('Unpaid','Part-paid')
        and (i.total - coalesce(p.paid,0)) > 0.005
        and cu.email is not null
      group by cu.id, cu.name, cu.email
    ) sub
  );
end;
$function$;

-- Remove the default "anyone can execute" and grant only where needed.
-- Supabase auto-grants execute to anon/authenticated at creation, so revoke from
-- anon explicitly (not just public) to fully lock anonymous callers out.
revoke execute on function public.outstanding_statements() from public, anon;
grant  execute on function public.outstanding_statements() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. due_for_sms_reminder(): approved staff (or the service-role cron) only.
--    Kept as `language sql`; the guard is added as a WHERE predicate, the same
--    approach timesheet() uses (`where is_owner()`). If the caller isn't allowed,
--    the predicate is false and the function simply returns no rows.
-- ----------------------------------------------------------------------------
create or replace function public.due_for_sms_reminder(p_limit integer default 5)
returns table (machine_id uuid, customer_id uuid, customer_name text, phone text, machine_label text, months integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, c.id, c.name, c.phone,
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
    and coalesce(c.phone, '') <> ''
    and (m.last_reminder_sent is null or m.last_reminder_sent < m.last_service_date)
    and age(now(), m.last_service_date) >= interval '12 months'
    and age(now(), m.last_service_date) <= interval '18 months'
  order by m.last_service_date asc
  limit greatest(coalesce(p_limit, 5), 0);
$$;

revoke execute on function public.due_for_sms_reminder(integer) from public, anon;
grant  execute on function public.due_for_sms_reminder(integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Storage policies: require approved staff, not just "logged in".
--    The service role bypasses RLS entirely, so send-invoice's uploads are
--    unaffected. Reads of the two PUBLIC photo buckets stay public (served via
--    the bucket) — we only tighten who can WRITE/DELETE there.
-- ----------------------------------------------------------------------------

-- Private `invoices` bucket: staff-only for every operation.
drop policy if exists invoices_read on storage.objects;
create policy invoices_read   on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and public.is_approved_staff());

drop policy if exists invoices_write on storage.objects;
create policy invoices_write  on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and public.is_approved_staff());

drop policy if exists invoices_update on storage.objects;
create policy invoices_update on storage.objects for update to authenticated
  using (bucket_id = 'invoices' and public.is_approved_staff())
  with check (bucket_id = 'invoices' and public.is_approved_staff());

drop policy if exists invoices_delete on storage.objects;
create policy invoices_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and public.is_approved_staff());

-- Public photo buckets: reads stay public; writes/deletes are staff-only.
drop policy if exists jobphotos_write on storage.objects;
create policy jobphotos_write     on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.is_approved_staff());

drop policy if exists jobphotos_delete on storage.objects;
create policy jobphotos_delete    on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.is_approved_staff());

drop policy if exists listingphotos_write on storage.objects;
create policy listingphotos_write  on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and public.is_approved_staff());

drop policy if exists listingphotos_delete on storage.objects;
create policy listingphotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_approved_staff());
