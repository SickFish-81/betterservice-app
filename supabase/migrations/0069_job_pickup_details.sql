-- ============================================================================
-- Betterservice ATV — keep the pick-up details on the job card (17 Sep 2026)
--
-- Craig's report: what he types into the pick-up boxes doesn't save.
--
-- He was right, and there was nothing subtle about it. The address, time and
-- notes lived only in the browser's memory on that page. They were assembled
-- into a text message and then thrown away — leave the job card, come back, and
-- the boxes are empty again. There were no columns to save them into.
--
-- Three plain text columns, deliberately not dates or times: a pick-up time in
-- a workshop is "today, 3pm" or "after lunch", and forcing that into a
-- timestamp would make the box harder to use than a piece of paper.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.job_cards
  add column if not exists pickup_address text,
  add column if not exists pickup_time    text,
  add column if not exists pickup_notes   text;

comment on column public.job_cards.pickup_address is 'Where the machine is being collected from. Free text; seeded from the customer''s address when blank.';
comment on column public.job_cards.pickup_time    is 'When, as a human would say it — "today, 3pm", "after lunch". Deliberately not a timestamp.';
comment on column public.job_cards.pickup_notes   is 'Gate code, which shed, who to ask for.';
