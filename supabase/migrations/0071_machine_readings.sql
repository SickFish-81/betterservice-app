-- Hours and odometer readings, captured per visit.
--
-- Craig asked to be able to enter hours and/or mileage on vehicles serviced.
--
-- WHY THE READING LIVES ON THE JOB CARD
-- -------------------------------------
-- The obvious version is one "current hours" box on the machine, overwritten
-- each service. That can never answer "what was it last time", which is the
-- question that actually matters: two readings give you hours per month, and
-- that is what tells you a machine doing 400 hours in six months needs
-- servicing sooner than one doing 40. Due For Service currently runs on a
-- 12-18 month date window and treats both the same.
--
-- So the reading is recorded against the job that observed it, and the most
-- recent one is stamped forward onto the machine for display. Same shape as
-- stamp_machine_service_date in 0063.
--
-- WHY THESE NAMES
-- ---------------
-- job_time_entries.hours already exists and means LABOUR hours - how long a
-- mechanic spent. These are machine hours off an hour meter. The machine_
-- prefix is there so nobody reads the wrong one at a glance. Do not shorten it.
--
-- WHY TWO COLUMNS RATHER THAN A NUMBER PLUS A UNIT
-- ------------------------------------------------
-- 36 of the 41 machines on file are ATVs or side-by-sides, which have hour
-- meters. Five are bikes, which have odometers. Some side-by-sides have both.
-- A single value with a unit flag means forever checking which one a number
-- was, and makes "both" impossible.

-- The readings themselves.
alter table public.job_cards
  add column if not exists machine_hours numeric(10,1),
  add column if not exists machine_km    integer;

comment on column public.job_cards.machine_hours is
  'Hour meter reading observed at this job. NOT labour hours - see job_time_entries.hours.';
comment on column public.job_cards.machine_km is
  'Odometer reading in km observed at this job.';

-- Typo guards. Generous on purpose: these catch a stray zero, not a wrong
-- number. A four digit hour meter is normal, six digits is not.
alter table public.job_cards
  drop constraint if exists job_cards_machine_hours_sane,
  add  constraint job_cards_machine_hours_sane
       check (machine_hours is null or (machine_hours >= 0 and machine_hours < 100000));

alter table public.job_cards
  drop constraint if exists job_cards_machine_km_sane,
  add  constraint job_cards_machine_km_sane
       check (machine_km is null or (machine_km >= 0 and machine_km < 2000000));

-- machines.odometer has been in the schema since 0001_schema_baseline and is
-- populated on zero of 41 machines and read by no code anywhere in the app. It
-- was always meant to be this. Renaming rather than adding a second column, so
-- there is one obvious place for a kilometre reading instead of two.
alter table public.machines rename column odometer to current_km;

alter table public.machines
  add column if not exists current_hours    numeric(10,1),
  add column if not exists reading_taken_on date;

comment on column public.machines.current_hours is
  'Most recent hour meter reading, stamped from a job card. Display only - the job cards are the record.';
comment on column public.machines.current_km is
  'Most recent odometer reading in km, stamped from a job card. Display only.';
comment on column public.machines.reading_taken_on is
  'job_date of the job card the current readings came from.';


create or replace function public.stamp_machine_reading()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.machine_id is null then return new; end if;
  if new.machine_hours is null and new.machine_km is null then return new; end if;

  update machines m
     set current_hours    = coalesce(new.machine_hours, m.current_hours),
         current_km       = coalesce(new.machine_km,    m.current_km),
         reading_taken_on = new.job_date
   where m.id = new.machine_id
     -- Only stamp if this job is at least as recent as whatever is stored.
     -- Entering an old job card after the fact must not overwrite a newer
     -- reading.
     and (m.reading_taken_on is null or new.job_date >= m.reading_taken_on);

  return new;
end;
$function$;

-- NOTE, and this is a deliberate difference from stamp_machine_service_date in
-- 0063, which uses greatest() so the date only ever moves forward.
--
-- A reading is NOT like a date. Hour meters fail and get replaced, and the new
-- one starts at zero. An odometer can be swapped with a cluster. If this only
-- ever moved the number upward, a machine with a replaced meter would be stuck
-- reading its old value forever and no one could correct it.
--
-- So the machine holds the MOST RECENT reading, not the HIGHEST. A reading that
-- goes backwards is a real thing that happens, and the job cards keep the full
-- history either way. The UI warns when a new reading is lower than the last
-- one, which is where a typo gets caught - by a person, not by a constraint.

drop trigger if exists trg_stamp_machine_reading on public.job_cards;
create trigger trg_stamp_machine_reading
  after insert or update of machine_hours, machine_km, job_date on public.job_cards
  for each row execute function public.stamp_machine_reading();

comment on function public.stamp_machine_reading() is
  'Copies the newest hours/km reading from a job card onto its machine for display. Most recent wins, not highest - meters get replaced.';

-- No backfill. machines.odometer was empty on every row and no job card has
-- ever carried a reading, so there is no history to recover. This starts from
-- the next job entered.
