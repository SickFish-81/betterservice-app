-- The machine's last service date is the date of its last invoice.
--
-- It was being set in the browser, inside approveAndSend() on the job card, and
-- only there. So the date was recorded only if someone clicked all the way
-- through "approve and send" AND the email went AND the page didn't error in
-- between. Invoice #01007 is the proof: raised 1 Sep, never sent, machine still
-- shows no service date. Every machine in the shop reads "never serviced", and
-- the whole reminder system hangs off that field.
--
-- Moving it into the database: the invoice IS the record of the service, so
-- creating one stamps the machine, whatever raised it — the job card, a resend,
-- a backfill, or anything added later. A browser tab closing at the wrong
-- moment can no longer lose it.
--
-- greatest() means the date only ever moves forward, so entering an old invoice
-- after the fact can't drag a machine's service date backwards and wrongly put
-- its owner into the reminder list.

create or replace function public.stamp_machine_service_date()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.job_card_id is null then return new; end if;

  update machines m
     set last_service_date = greatest(
           coalesce(m.last_service_date, new.issued_date),
           new.issued_date)
    from job_cards j
   where j.id = new.job_card_id
     and m.id = j.machine_id
     and new.issued_date is not null;

  return new;
end;
$function$;

drop trigger if exists trg_stamp_machine_service_date on public.invoices;
create trigger trg_stamp_machine_service_date
  after insert or update of issued_date on public.invoices
  for each row execute function public.stamp_machine_service_date();

comment on function public.stamp_machine_service_date() is
  'Sets machines.last_service_date from the invoice raised against the job card. The date only moves forward.';


-- Backfill: every machine that has ever been invoiced gets the date of its most
-- recent invoice. This is what makes the reminder clock start from real history
-- instead of from the day this migration ran.
update machines m
   set last_service_date = x.last_invoice
  from (
    select j.machine_id, max(i.issued_date) as last_invoice
    from invoices i
    join job_cards j on j.id = i.job_card_id
    where j.machine_id is not null and i.issued_date is not null
    group by j.machine_id
  ) x
 where m.id = x.machine_id
   and (m.last_service_date is null or m.last_service_date < x.last_invoice);
