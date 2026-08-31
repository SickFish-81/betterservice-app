-- ============================================================================
-- Betterservice ATV — bill the company, keep the person as the contact (31 Aug 2026)
--
-- Some machines belong to a business: an orchard, a contractor, a farm. The
-- person who drops the bike off and answers the phone is still the contact, but
-- the invoice has to be addressed to the company that pays it — a business can't
-- claim GST on an invoice made out to an employee.
--
-- Blank means what it has always meant: the customer is the one charged.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.customers
  add column if not exists company_name text;
