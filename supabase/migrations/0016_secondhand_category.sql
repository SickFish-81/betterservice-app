-- ============================================================================
-- Betterservice Te Puke — For Sale catalog categories
-- Built 16 July 2026. Groups used-machine listings into categories on the
-- public For Sale page: ATV / 4 Wheeler, Side by Side, 2 Wheeler, Other.
-- ============================================================================

alter table public.secondhand_listings add column if not exists category text;
