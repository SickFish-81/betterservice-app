-- The unsent-invoice check was crying wolf on every invoice in it.
--
-- WHAT WAS WRONG
-- --------------
-- invoices_unsent filtered on `i.sent is not true` and nothing else, and the
-- daily email to Craig ran its own copy of the same idea
-- (invoices?kind=eq.atv&sent=eq.false) in generate-rental-invoices.
--
-- On 29 Sep the entire list was three invoices totalling $1,685.50 — #01014
-- Neil Mackie, #01018 Miguel, #01025 Seamus — and all three were PAID IN FULL
-- by Eftpos days earlier, with the payments recorded. None of them has an email
-- address, so none of them could ever be sent. The check was nagging daily
-- about money already in the till, asking for something impossible.
--
-- Zero unpaid invoices were unsent. The list was 100% noise, which is how a
-- real one gets scrolled past.
--
-- WHY PAID MEANS DONE
-- -------------------
-- The comment on the check in generate-rental-invoices states its own purpose:
-- "An invoice nobody sends is money the shop has done the work for and not
-- asked for". That stops being true the moment it is paid. A counter job paid
-- by Eftpos has had its paperwork handled in person — Craig prints the PDF and
-- hands it over — and the customer is not waiting on an email.
--
-- WHY 'SETTLED' AND NOT 'EFTPOS'
-- ------------------------------
-- The case that prompted this was Eftpos, but cash and bank transfer are the
-- same shape: the work is done, the money is in, nobody is waiting. Keying on
-- the payment method would leave a smaller version of the same false alarm.
-- Credited is in for the same reason — a credited invoice is settled, not owed.
--
-- status is safe to test: trg_sync_invoice_status maintains it from payments,
-- and trg_credit_note_status from credit notes.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not track whether a paid customer ever received a copy. Deliberate.
-- A separate quieter list was considered and rejected: the point here is money
-- at risk, and a second list of things that are fine is how the first one stops
-- being read.

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
where i.sent is not true
  -- Added 29 Sep 2026. Settled invoices are not money at risk.
  and coalesce(i.status, '') not in ('Paid', 'Credited');

comment on view public.invoices_unsent is
  'Invoices that have not reached the customer AND are not settled, plus why. A rental here is waiting for approval; anything else has been missed. Paid and Credited are excluded on purpose: the point is money the shop has not been paid for, and a paid counter job has had its paperwork done in person.';
