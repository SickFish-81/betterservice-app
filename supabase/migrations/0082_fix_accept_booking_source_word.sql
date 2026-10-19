-- Accepting a website booking has never worked.
--
-- accept_booking_request() inserts a job card with source 'Online'. The
-- job_cards check constraint allows only 'Website', 'Phone' and 'Walk-in':
--
--   job_cards_source_check CHECK (source = ANY (ARRAY['Website','Phone','Walk-in']))
--
-- So every accept fails with:
--
--   new row for relation "job_cards" violates check constraint
--   "job_cards_source_check"
--
-- Wrong since migration 0047, and nobody hit it because the only booking
-- before today was declined rather than accepted. Craig found it on 19 Oct
-- 2026 with a real customer's job sitting in the queue.
--
-- 'Online' appears exactly once in the entire codebase: in that one insert.
-- Two words for one thing, disagreeing in the only place it mattered.
-- 'Website' wins - it is what the constraint allows.
--
-- Only that string changes; the rest is 0047's function unaltered.
-- Applied to production 19 Oct 2026, and proved against Craig's actual stuck
-- booking in a rolled-back transaction: job card created, source 'Website',
-- customer and machine created, booking left untouched for him to accept.

create or replace function public.accept_booking_request(p_id uuid)
 returns job_cards
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r   booking_requests;
  v_customer uuid;
  v_machine  uuid;
  v_job      job_cards;
begin
  if not is_approved_staff() then
    raise exception 'Not authorized';
  end if;

  select * into r from booking_requests where id = p_id;
  if not found then raise exception 'No such booking request'; end if;
  if r.status <> 'new' then raise exception 'That request has already been dealt with.'; end if;

  select id into v_customer from customers where lower(email) = lower(r.email) limit 1;
  if v_customer is null then
    insert into customers (name, phone, email, address, company_name)
      values (r.contact_name, r.phone, r.email,
              case when r.pickup_needed then r.pickup_address else null end,
              r.company_name)
      returning id into v_customer;
  else
    -- Fill gaps on an existing record, never overwrite what's already there.
    update customers
       set phone        = coalesce(nullif(btrim(phone), ''), r.phone),
           company_name = coalesce(nullif(btrim(company_name), ''), r.company_name)
     where id = v_customer;
  end if;

  if coalesce(r.machine_make, r.machine_model) is not null then
    select id into v_machine from machines
     where customer_id = v_customer
       and coalesce(lower(make), '')  = coalesce(lower(r.machine_make), '')
       and coalesce(lower(model), '') = coalesce(lower(r.machine_model), '')
     limit 1;
    if v_machine is null then
      insert into machines (customer_id, type, make, model)
        values (v_customer, coalesce(r.machine_type, 'ATV'), coalesce(r.machine_make, ''), coalesce(r.machine_model, ''))
        returning id into v_machine;
    end if;
  end if;

  insert into job_cards (customer_id, machine_id, reported_problem, source, notes)
    values (v_customer, v_machine, r.reported_problem, 'Website',   -- was 'Online': not an allowed value
            nullif(concat_ws(E'\n',
              case when r.pickup_needed then 'PICK-UP NEEDED: ' || coalesce(r.pickup_address, '(no address given)') end,
              r.notes), ''))
    returning * into v_job;

  update booking_requests
     set status = 'accepted', customer_id = v_customer, job_card_id = v_job.id,
         handled_at = now(), handled_by = auth.uid()
   where id = p_id;

  return v_job;
end;
$function$;
