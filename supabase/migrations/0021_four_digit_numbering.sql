-- ============================================================================
-- Betterservice Te Puke — PO + invoice numbers start at 1000 (Phase 3j)
-- Built 16 July 2026. Craig wants purchase orders and invoices to begin at a
-- 4-digit number rather than 00001. Both tables are empty at go-live, so the
-- identity sequences are simply restarted at 1000. Displays use 4-digit padding.
-- ============================================================================

alter table public.invoices        alter column invoice_number restart with 1000;
alter table public.purchase_orders alter column po_number      restart with 1000;
