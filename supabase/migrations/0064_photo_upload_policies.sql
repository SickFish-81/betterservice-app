-- Photo uploads have never worked. Not once, in either bucket.
--
-- listing-photos and job-photos have both been empty since the day they were
-- created. The 96 rows in secondhand_photos are Trade Me URLs with path = null,
-- imported rather than uploaded, which is why the gap was never obvious.
--
-- Craig's attempts on 3 Sep came back 400, which reads like a bad file. The
-- storage log says what really happened:
--
--   queryName : UpsertObject
--   code      : 42501
--   message   : new row violates row-level security policy
--
-- Storage runs one statement for an upload:
--
--   INSERT INTO storage.objects (...) VALUES (...)
--     ON CONFLICT (name, bucket_id) DO UPDATE SET ...
--     RETURNING *
--
-- That single statement needs THREE permissions, and these buckets granted one:
--
--   INSERT  - granted
--   UPDATE  - needed only for the ON CONFLICT half, which appears because the
--             client asked for upsert. Removed in the app instead: the path
--             already carries a timestamp and a random suffix, so there is
--             never a conflict and nothing to gain from upsert.
--   SELECT  - needed for RETURNING *, and there is no way around it. This is
--             the part that is easy to miss, because "I only want to write a
--             file" doesn't sound like it needs read permission.
--
-- The invoices bucket has all three and has always worked, which is the
-- comparison that gave it away.
--
-- Granting SELECT here gives away nothing: both buckets are PUBLIC, so the
-- files are already readable by anyone holding the URL. This only lets an
-- approved staff member's own upload return the row it just wrote.

create policy listingphotos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'listing-photos' and public.is_approved_staff());

create policy jobphotos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'job-photos' and public.is_approved_staff());
