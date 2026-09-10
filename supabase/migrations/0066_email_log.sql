-- 0066_email_log.sql
--
-- ALREADY APPLIED to production on 10 Sep 2026, before this file existed in
-- the repo. It was run from a copy in ~/Downloads numbered 0059, which had
-- already been used by 0059_rental_power_charge.sql, so it is renumbered here
-- to the next free slot. Everything below is idempotent (create ... if not
-- exists / create or replace), so re-running it against production is safe
-- and changes nothing.
-- Two problems, one migration.
--
-- 1. "sent = true" only ever meant "Resend accepted the API call". email_log
--    plus the resend-webhook function turn that into a real delivery record.
-- 2. "sent = false" is doing two unrelated jobs -- "waiting for Craig" on a
--    rental, and "nobody has touched this in nine days" on a job card. Nothing
--    surfaced the second, which is how six ATV invoices sat unsent. The
--    invoices_unsent view separates them.
--
-- Additive only: creates one table and three views, alters nothing existing.
-- Verified against the live schema before writing: customers.id and
-- rental_agreements.id are uuid, invoices.invoice_number is unique, is_owner()
-- exists, and email_log does not already exist.

create table if not exists public.email_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- What it was.
  kind         text not null,
  subject      text,

  -- Nullable on purpose. A row with no recipient is the record of an invoice we
  -- could NOT send because no address was on file -- exactly the Neil Mackie
  -- case. That is worth keeping, not discarding.
  to_email     text,
  bcc_email    text,

  -- What it relates to. All optional; fill in whatever applies.
  invoice_id           uuid references public.invoices(id) on delete set null,
  customer_id          uuid references public.customers(id) on delete set null,
  rental_agreement_id  uuid references public.rental_agreements(id) on delete set null,

  -- Who caused it. NULL means an automatic job did, with no human approval --
  -- which is precisely what distinguishes #01008 from #01009.
  sent_by      uuid,

  -- Resend's own id. The one thing linking a row here to a row in their
  -- dashboard. Nullable because a failed send never gets one.
  resend_id    text unique,

  -- Where it got to.
  status       text not null default 'accepted'
    check (status in ('accepted','sent','delivered','delivery_delayed','bounced','complained','failed')),
  last_event_at  timestamptz,
  delivered_at   timestamptz,
  bounced_at     timestamptz,
  bounce_reason  text,
  opened_at      timestamptz,
  error          text
);

comment on table public.email_log is
  'One row per outbound email attempt. status starts at accepted (Resend took it) and is advanced by the resend-webhook function.';
comment on column public.email_log.sent_by is
  'Staff user_id who triggered it. NULL means an automatic job sent it with no human approval.';
comment on column public.email_log.to_email is
  'NULL means there was no address to send to -- the attempt is recorded so it cannot be silently lost.';

create index if not exists email_log_created_idx   on public.email_log (created_at desc);
create index if not exists email_log_invoice_idx   on public.email_log (invoice_id);
create index if not exists email_log_customer_idx  on public.email_log (customer_id);
create index if not exists email_log_attention_idx on public.email_log (status)
  where status in ('accepted','sent','delivery_delayed','bounced','complained','failed');

alter table public.email_log enable row level security;

drop policy if exists email_log_owner_read on public.email_log;
create policy email_log_owner_read on public.email_log
  for select to authenticated
  using (public.is_owner());

-- No insert/update/delete policy, deliberately. Only the service role writes,
-- and it bypasses RLS. Evidence nobody can edit is worth more than evidence
-- anybody can.


-- ---------------------------------------------------------------------------
-- Did it land? One row per invoice, carrying the fate of its latest email.
-- security_invoker so the reader's own RLS still applies.
-- ---------------------------------------------------------------------------
create or replace view public.invoice_delivery with (security_invoker = true) as
select
  i.id            as invoice_id,
  i.invoice_number,
  i.kind,
  i.total,
  i.sent,
  i.sent_at,
  i.sent_by,
  e.to_email,
  e.status,
  e.delivered_at,
  e.bounced_at,
  e.bounce_reason,
  e.opened_at,
  e.resend_id,
  case
    when i.sent is not true                             then 'Not sent'
    when e.id is null                                   then 'Sent before logging existed'
    when e.status = 'delivered'                         then 'Delivered'
    when e.status in ('bounced','complained','failed')  then 'Did not arrive'
    when e.created_at > now() - interval '30 minutes'   then 'In flight'
    else 'Not confirmed'
  end as plain_status
from public.invoices i
left join lateral (
  select l.* from public.email_log l
   where l.invoice_id = i.id
   order by l.created_at desc
   limit 1
) e on true;

comment on view public.invoice_delivery is
  'Every invoice with the fate of its most recent email. plain_status is the version to put in front of a human.';


-- ---------------------------------------------------------------------------
-- The money view: invoiced, but never reached the customer.
-- Dates are computed in NZ time, not UTC, or an invoice raised this morning
-- reads as raised yesterday.
-- ---------------------------------------------------------------------------
create or replace view public.invoices_unsent with (security_invoker = true) as
select
  i.id            as invoice_id,
  i.invoice_number,
  i.kind,
  i.total,
  i.status,
  i.issued_date,
  coalesce(c.name,  c2.name)  as customer,
  coalesce(nullif(trim(c.email), ''), nullif(trim(c2.email), '')) as email,
  ((now() at time zone 'Pacific/Auckland')::date - i.issued_date) as days_waiting,
  case
    when coalesce(nullif(trim(c.email), ''), nullif(trim(c2.email), '')) is null
      then 'No email address on file'
    when i.kind = 'rental' then 'Waiting for approval'
    else 'Never sent'
  end as reason
from public.invoices i
left join public.customers c  on c.id  = i.customer_id
left join public.job_cards  j  on j.id  = i.job_card_id
left join public.customers  c2 on c2.id = j.customer_id
where i.sent is not true;

comment on view public.invoices_unsent is
  'Invoices that have not reached the customer, and why. A rental here is waiting for approval; anything else has simply been missed.';


-- ---------------------------------------------------------------------------
-- Emails worth acting on: bounced, refused, or unconfirmed for too long.
-- ---------------------------------------------------------------------------
create or replace view public.email_attention with (security_invoker = true) as
select *
  from public.email_log
 where status in ('bounced','complained','failed')
    or (status in ('accepted','sent','delivery_delayed')
        and created_at < now() - interval '30 minutes');

comment on view public.email_attention is
  'Emails that bounced, were rejected, or have not been confirmed delivered after 30 minutes.';
