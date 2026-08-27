-- ============================================================================
-- Betterservice Te Puke — shop copy of every emailed invoice (27 Aug 2026)
--
-- Every invoice emailed to a customer also goes, blind, to the shop's own address
-- so there's an independent record outside the app — useful for the accountant,
-- and a safety net if the database were ever lost.
--
-- BCC rather than CC: the customer must not see the shop's internal address, and
-- a visible second recipient on an invoice looks unprofessional.
--
-- Stored as a setting rather than hardcoded in the Edge Function so the address
-- can be changed on the Settings page without a redeploy. Blank it to switch the
-- copies off entirely.
-- ============================================================================
alter table public.shop_settings
  add column if not exists invoice_bcc text;

update public.shop_settings
  set invoice_bcc = 'admin@betterservice.co.nz'
  where invoice_bcc is null;

comment on column public.shop_settings.invoice_bcc is
  'Blind copy address for outgoing invoice emails. Blank = no copy sent.';
