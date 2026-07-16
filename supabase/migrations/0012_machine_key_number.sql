-- ============================================================================
-- Betterservice Te Puke — machine identifier: VIN or key number (not rego)
-- Built 14 July 2026. Off-road bikes/ATVs often aren't registered, so machines
-- are identified by VIN or key number. `vin` already exists (0001); add
-- `key_number`. The `rego` column is kept (existing data) but retired from the UI.
-- ============================================================================

alter table public.machines add column if not exists key_number text;
