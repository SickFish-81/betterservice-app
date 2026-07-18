-- 0026_staff_phone.sql
-- Add a phone number to staff so they can be texted via the SMS route
-- (e.g. the machine pick-up dispatch). Additive and idempotent.

alter table public.staff add column if not exists phone text;
