-- The Flipbikes shop writes nothing to email_log. The rows that exist for shop
-- emails were created by Resend's own delivery webhook for a message it did not
-- recognise: kind 'unknown', no link to the order, and - because Resend fires a
-- separate event per recipient and the webhook only sets to_email when it
-- CREATES the row - only whichever recipient's event happened to arrive first.
--
-- On 14 Oct that misled a diagnosis: the order email for FLIP-1002 logged one
-- recipient, which looked like evidence that Craig had not been emailed. He had.
--
-- So the shop now logs its own sends. This is the column that lets one of those
-- rows point at the order it belongs to. Nullable and unconstrained:
-- Betterservice's own emails will never set it, and a Stripe session id is not
-- a foreign key to anything in this database.
--
-- Applied to production 15 Oct 2026.

alter table public.email_log
  add column if not exists flip_session_id text;

comment on column public.email_log.flip_session_id is
  'Stripe checkout session id, for emails sent by the Flipbikes shop. Null for Betterservice emails.';

create index if not exists email_log_flip_session_id_idx
  on public.email_log (flip_session_id)
  where flip_session_id is not null;
