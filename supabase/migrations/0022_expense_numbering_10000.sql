-- ============================================================================
-- Betterservice Te Puke — expense numbers start at 10000 (Phase 3l)
-- Built 16 July 2026. Craig wants expenses to begin at EXP-10000 rather than
-- 00001. The expenses table is empty at go-live, so the identity sequence is
-- restarted at 10000. Display already pads to 5 digits, so 10000 shows as-is.
-- ============================================================================

alter table public.expenses alter column expense_number restart with 10000;
