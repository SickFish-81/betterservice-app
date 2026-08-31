-- ============================================================================
-- Betterservice ATV — notes from the workshop, for the customer (31 Aug 2026)
--
-- job_cards.notes already exists, but it is an INTERNAL field: it is texted to
-- whoever is set as "Picked up by", along with the address and time. It is the
-- wrong place for findings meant for the customer — a mechanic's note would go
-- to the pick-up driver instead, and anything genuinely internal already in
-- there would end up printed in front of the customer.
--
-- So customer-facing findings ("brakes 1/2 worn", "clutch adjusted to spec")
-- get their own field, which prints on the invoice under the line items.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.job_cards
  add column if not exists customer_notes text;
