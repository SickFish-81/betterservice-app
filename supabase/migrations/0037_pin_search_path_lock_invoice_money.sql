-- ============================================================================
-- Betterservice Te Puke — pin search_path on lock_invoice_money (26 Aug 2026)
-- Migration 0036 added lock_invoice_money() without `set search_path`, making it
-- the only function in the database with a mutable search path (flagged by the
-- Supabase database linter, lint 0011). Every other trigger/definer function in
-- this project pins it. Behaviour is unchanged — this only fixes the setting.
-- Idempotent: create-or-replace; the existing trigger keeps pointing at it.
-- ============================================================================
create or replace function public.lock_invoice_money()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.subtotal is distinct from old.subtotal
     or new.gst   is distinct from old.gst
     or new.total is distinct from old.total then
    raise exception 'Invoice totals are fixed at creation — discard and regenerate the invoice to change them.';
  end if;
  return new;
end;
$function$;
