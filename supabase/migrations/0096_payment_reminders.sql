-- Payment reminders for overdue invoices (27 Nov 2026).
--
-- Ben: "we need to look at sending out invoices that havent been paid for over
-- a month, there is quite a bit of outstanding money to come in". On 27 Nov
-- $22,472 was owing across 30 invoices, 20 of them past their 7-day due date.
--
-- Ben's calls:
--   * remind on invoices 14 or more days past their due date;
--   * one email per customer, listing every such invoice with the PDFs attached;
--   * Craig sends them by pressing a button (the Overdue page), and each
--     reminder is recorded so nobody is chased twice in the same week.
--
-- The monthly-statements job is a separate thing and stays paused.
--
-- This adds:
--   * invoice_reminders     one row per invoice per reminder sent. Written only
--                           by the send-payment-reminder function (service role).
--   * customers.no_payment_reminders  for accounts that must never be chased:
--                           Betterservice's own internal "customers".
--   * shop_settings.overdue_email_subject / overdue_email_body  editable wording,
--                           blank = the function's default.
--   * overdue_invoices(p_min_days)  the list, worked out one way for the page
--                           and the function alike.

create table if not exists public.invoice_reminders (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id),
  sent_at     timestamptz not null default now(),
  sent_by     uuid,
  to_email    text,
  resend_id   text
);
create index if not exists invoice_reminders_invoice_idx on public.invoice_reminders (invoice_id, sent_at desc);

alter table public.invoice_reminders enable row level security;
create policy invoice_reminders_staff_read on public.invoice_reminders
  for select to authenticated using (is_approved_staff());
revoke all on public.invoice_reminders from anon;
grant select on public.invoice_reminders to authenticated;

alter table public.customers add column if not exists no_payment_reminders boolean not null default false;
comment on column public.customers.no_payment_reminders is 'Never send this customer an overdue-payment reminder (internal accounts).';
update public.customers set no_payment_reminders = true
 where name in ('Sales Prep Betterservice', 'Betterservice sales');

alter table public.shop_settings add column if not exists overdue_email_subject text;
alter table public.shop_settings add column if not exists overdue_email_body text;

-- Balance = total less payments less credit notes, the same sum the Invoices
-- page uses. Days overdue are counted in NZ time from the due date (or the issue
-- date when an invoice has none). SECURITY INVOKER: staff see it through their
-- own RLS, and the function reads it with the service role.
create or replace function public.overdue_invoices(p_min_days integer default 14)
returns table (
  invoice_id       uuid,
  invoice_number   bigint,
  issued_date      date,
  due_date         date,
  days_overdue     integer,
  balance          numeric,
  customer_id      uuid,
  customer_name    text,
  customer_email   text,
  last_reminded_at timestamptz,
  excluded         boolean
)
language sql
stable
set search_path to 'public'
as $function$
  with today as (select (now() at time zone 'Pacific/Auckland')::date as d),
  b as (
    select i.id, i.invoice_number, i.issued_date,
           coalesce(i.due_date, i.issued_date) as due,
           i.total
             - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id), 0)
             - coalesce((select sum(c.total) from credit_notes c where c.invoice_id = i.id), 0) as bal,
           coalesce(j.customer_id, i.customer_id) as cust
      from invoices i
      left join job_cards j on j.id = i.job_card_id
     where i.finalised_at is not null
       and i.status not in ('Paid', 'Credited')
  )
  select b.id, b.invoice_number, b.issued_date, b.due,
         (today.d - b.due)::int,
         round(b.bal, 2),
         c.id,
         coalesce(nullif(btrim(c.name), ''), c.company_name),
         nullif(btrim(c.email), ''),
         (select max(r.sent_at) from invoice_reminders r where r.invoice_id = b.id),
         coalesce(c.no_payment_reminders, false)
    from b
    cross join today
    left join customers c on c.id = b.cust
   where b.bal > 0.005
     and today.d - b.due >= greatest(coalesce(p_min_days, 14), 0)
   order by coalesce(nullif(btrim(c.name), ''), c.company_name), b.issued_date;
$function$;

revoke execute on function public.overdue_invoices(integer) from public, anon;
grant  execute on function public.overdue_invoices(integer) to authenticated, service_role;

-- Automatic reminders (Ben, 27 Nov: "auto send every 14 days"). Weekday
-- mornings the job asks send-payment-reminder to remind every customer with
-- something 14+ days overdue who hasn't been reminded in the last 14 days.
-- 20:05 UTC Sun–Thu = 9:05am NZDT Mon–Fri (8:05am in NZ winter).
--
-- The secret is read from Vault at run time, so it never sits in the job's
-- text. Ben adds it himself, the same value in both places:
--   * Edge Function secret  PAYMENT_REMINDER_SECRET
--   * Vault secret named    payment_reminder_secret
-- Until both exist the job runs and is refused (403); nothing is sent.
select cron.schedule(
  'payment-reminders',
  '5 20 * * 0-4',
  $cron$
  select net.http_post(
    url := 'https://vdwssiefdhmepdgkuoxd.supabase.co/functions/v1/send-payment-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'payment_reminder_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
