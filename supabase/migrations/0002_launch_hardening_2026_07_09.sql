-- ============================================================================
-- Launch-readiness hardening — applied to production 2026-07-09.
-- (Already reflected in 0001; kept as a record of what changed in review.)
-- ============================================================================

-- 1) Deleting a customer must NOT wipe their machines. CASCADE -> NO ACTION.
alter table public.machines drop constraint machines_customer_id_fkey;
alter table public.machines add  constraint machines_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete no action;

-- 2) Lock the SECURITY DEFINER helpers to authenticated callers only.
revoke execute on function public.is_approved_staff()      from public;
revoke execute on function public.is_owner()               from public;
revoke execute on function public.current_staff_can_send() from public;
grant  execute on function public.is_approved_staff()      to authenticated;
grant  execute on function public.is_owner()               to authenticated;
grant  execute on function public.current_staff_can_send() to authenticated;

-- 3) Make invoice PDFs private (customer details, amounts, GST#, bank account).
update storage.buckets set public = false where id = 'invoices';
drop policy if exists invoices_read on storage.objects;
create policy invoices_read on storage.objects
  for select to authenticated using (bucket_id = 'invoices');
