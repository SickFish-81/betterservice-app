-- 0025_seed_service_checklists.sql
-- Seed standard service checklist templates from the shop's existing Numbers checklists.
-- Consumed by /templates and applied to jobs via job_checklist_items (see app/jobs/[id]/page.js).
-- Idempotent: each template is only inserted if one with the same name doesn't already exist,
-- so it's safe to run more than once.

insert into public.checklist_templates (name, items)
select 'Full 2-Wheeler Service', array[
  'Tyres and tyre pressures checked',
  'Throttle and cable checked and lubed',
  'Front brake checked and adjusted',
  'Rear brake checked and adjusted',
  'Carburettor and fuel system checked',
  'Air filter cleaned and oiled',
  'Spark plug replaced',
  'Battery checked, charged OK',
  'Charging system checked OK',
  'All lights work',
  'All kill switches work',
  'Chain checked and adjusted',
  'Sprockets checked',
  'Wheel bearings checked',
  'Swingarm bearings checked',
  'Starter motor working OK',
  'Kick start tight and works',
  'Rear shock checked',
  'Rear suspension linkages checked',
  'Front forks checked',
  'Handgrips checked, replaced?',
  'Side panels, fairings secured OK',
  'Valve clearances checked, adjusted',
  'Engine starts and runs OK',
  'Oil and filter changed',
  'Exhaust checked',
  'Plastics all secure',
  'Side stands checked',
  'Gearbox load test completed',
  'Bike ride test completed OK',
  'Maintenance reminder set on speedo, sticker placed'
]::text[]
where not exists (
  select 1 from public.checklist_templates where name = 'Full 2-Wheeler Service'
);

insert into public.checklist_templates (name, items)
select 'Full ATV Service', array[
  'Engine oil and filter changed',
  'Cooling system checked OK (if liquid-cooled)',
  'Radiator cleaned and cooling fan working (if fitted)',
  'Transmission / gearbox oil checked and clean',
  'Front and rear diff oil checked',
  'Engine starts and runs OK',
  'CVT belt checked OK, no slippage',
  'Fuel filter and fuel system checked',
  'Air filter cleaned and oiled',
  'Spark plug(s) replaced',
  'Valve clearances checked, adjusted',
  'Throttle and cable checked and lubed',
  'Battery checked, connections and voltage OK',
  'Charging system checked OK',
  'Starter motor working OK',
  'All lights work',
  'Kill switch and key switch work',
  'Front brakes checked and adjusted',
  'Rear brakes checked and adjusted',
  'Park / hand brake working and adjusted OK',
  'Wheel bearings checked',
  'Tyres and tyre pressures checked',
  'Steering and tie rods checked, no play',
  'Front A-arm bushes checked',
  'Rear A-arm / swingarm bushes checked',
  'Front and rear suspension checked, lubed OK',
  'All CV boots checked for cracks or damage',
  'Front and rear PTO / prop shafts checked',
  '4WD/2WD operation checked',
  'All grease nipples / lube points greased',
  'Racks and carriers secure',
  'Towbar and mounts OK (if fitted)',
  'Winch working in and out (if fitted)',
  'Ride test completed OK',
  'Maintenance reminder set on speedo, sticker placed'
]::text[]
where not exists (
  select 1 from public.checklist_templates where name = 'Full ATV Service'
);

insert into public.checklist_templates (name, items)
select 'Full SxS / UTV Service', array[
  'Engine oil and filter changed',
  'Cooling system checked OK',
  'Transmission oil checked and clean',
  'Engine starts and runs OK',
  'CVT belt checked OK, no slippage',
  'Fuel filter and fuel system checked',
  'Air filter cleaned and oiled',
  'Throttle and cable checked and lubed',
  'Battery checked, connections checked, voltage',
  'Charging system checked OK',
  'Starter motor working OK',
  'Front brake checked and adjusted',
  'Rear brake checked and adjusted',
  'Wheel bearings checked',
  'Front A-arm bushes checked',
  'Rear A-arm bushes checked',
  'Rear PTO and front PTO checked',
  'All CV boots checked for cracks or damage',
  'Front and rear diff oil checked',
  '4WD/2WD operation checked',
  'Spark plugs replaced',
  'Valve clearances checked, adjusted',
  'Handbrake working and adjustment OK',
  'Front and rear suspension checked, lubed OK',
  'Rear tray struts and pivot bolts checked OK',
  'Towbar and mounts OK',
  'Roof and windows secure and clean',
  'Door hinges and locks checked',
  'Radiator cleaned',
  'Electric fan working?',
  'Window wiper working',
  'All lights work',
  'Key switches work',
  'Winch working in and out',
  'Side panels, fairings secured OK',
  'Tyres and tyre pressures checked',
  'Cigarette lighter working',
  'Seatbelts OK and working',
  'Top light working',
  'Maintenance reminder set on speedo, sticker placed',
  'Ride test completed OK'
]::text[]
where not exists (
  select 1 from public.checklist_templates where name = 'Full SxS / UTV Service'
);
