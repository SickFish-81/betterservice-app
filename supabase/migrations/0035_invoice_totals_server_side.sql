-- 0035_invoice_totals_server_side.sql
-- Money integrity: derive invoice subtotal/gst/total on the server from the
-- job's own line items, instead of trusting whatever the browser sends. The
-- insert trigger posts to the ledger from these figures, so they must be
-- correct. The app calls this via .rpc('generate_invoice', { p_job_id }).
-- Idempotent: safe to re-run.
create or replace function public.generate_invoice(p_job_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count    int;
  v_subtotal numeric;
  v_gst      numeric;
  v_total    numeric;
  v_inv      public.invoices;
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;
  if p_job_id is null then
    raise exception 'No job specified';
  end if;
  if exists (select 1 from invoices where job_card_id = p_job_id) then
    raise exception 'This job already has an invoice.';
  end if;

  select count(*), coalesce(round(sum(amount), 2), 0)
    into v_count, v_subtotal
  from job_line_items
  where job_card_id = p_job_id;

  if v_count = 0 then
    raise exception 'Nothing to invoice — add labour or parts first.';
  end if;

  v_gst   := round(v_subtotal * 0.15, 2);
  v_total := v_subtotal + v_gst;

  insert into invoices (job_card_id, subtotal, gst, total, status)
    values (p_job_id, v_subtotal, v_gst, v_total, 'Unpaid')
    returning * into v_inv;

  update job_cards set status = 'Invoiced' where id = p_job_id;

  return v_inv;
end;
$$;

revoke execute on function public.generate_invoice(uuid) from public, anon;
grant  execute on function public.generate_invoice(uuid) to authenticated, service_role;
