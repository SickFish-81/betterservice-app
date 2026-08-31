-- ============================================================================
-- Betterservice ATV — one live tenancy per unit (31 Aug 2026)
--
-- The no-double-bill guard added in 0043 is a unique index on
-- (rental_agreement_id, period_start): it stops the SAME agreement being billed
-- twice for a month. It does NOT stop two agreements existing on the same unit,
-- which would bill one tenant twice for one shed. This closes that.
--
-- An exclusion constraint is the right tool: two rows for the same unit whose
-- date ranges overlap are simply rejected by the database, so no amount of
-- mis-clicking in the app can create the situation. Sequential tenancies are
-- still fine — end one, start the next.
--
-- NOTE: this will FAIL if overlapping tenancies already exist. Find them with:
--   select a.id, u.name, a.start_date, a.end_date, a.on_hold
--     from rental_agreements a join rental_units u on u.id = a.unit_id
--    order by u.name, a.start_date;
-- Delete the wrong one, then run this again. "On hold" does not count as ended —
-- a held tenancy still occupies the unit, which is the point of it.
--
-- Idempotent: safe to re-run.
-- ============================================================================

create extension if not exists btree_gist;

alter table public.rental_agreements
  drop constraint if exists rental_agreements_no_overlap;

alter table public.rental_agreements
  add constraint rental_agreements_no_overlap
  exclude using gist (
    unit_id with =,
    daterange(start_date, end_date, '[]') with &&
  );
