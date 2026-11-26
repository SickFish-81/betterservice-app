-- Job cards can say they came from Stock (26 Nov 2026).
--
-- Ben: "for the bikes that are now showing in stock (Craig has bought them to
-- do up and sell) we want to be able to create a job card straight from that
-- stock window". Those jobs aren't a phone call, a website booking or a
-- walk-in, so the source check gains 'Stock' and the record says where the
-- job really came from.

alter table public.job_cards drop constraint if exists job_cards_source_check;
alter table public.job_cards add constraint job_cards_source_check
  check (source = any (array['Website', 'Phone', 'Walk-in', 'Stock']));
