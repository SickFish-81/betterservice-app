-- ============================================================================
-- Betterservice Te Puke — money constraints + photo privacy (21 July 2026)
-- CODE_REVIEW.md:
--   #8  Add the same 2-decimal-place check to invoices that every other money
--       table already has (credit_notes, payments, expenses). The app now rounds
--       invoice totals before saving, so these can never be tripped by real data.
--   #9  Anonymous visitors can only read photos of listings that are 'Available'
--       (they could previously fetch photos of unpublished / sold machines).
-- Idempotent: drop-if-exists before each add.
-- ============================================================================

-- #9: public (anon) can only see photos of Available listings; staff still see all.
drop policy if exists public_read on public.secondhand_photos;
create policy public_read on public.secondhand_photos for select to anon
  using (exists (
    select 1 from public.secondhand_listings l
    where l.id = secondhand_photos.listing_id and l.status = 'Available'
  ));

-- #8: invoice amounts must be exactly 2dp (matches the other money tables).
alter table public.invoices drop constraint if exists invoices_subtotal_2dp;
alter table public.invoices add  constraint invoices_subtotal_2dp check (subtotal = round(subtotal, 2));
alter table public.invoices drop constraint if exists invoices_gst_2dp;
alter table public.invoices add  constraint invoices_gst_2dp      check (gst = round(gst, 2));
alter table public.invoices drop constraint if exists invoices_total_2dp;
alter table public.invoices add  constraint invoices_total_2dp    check (total = round(total, 2));
