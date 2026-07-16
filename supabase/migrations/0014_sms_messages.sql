-- ============================================================================
-- Betterservice Te Puke — SMS to customers (texting)
-- Built 16 July 2026. Adds a log of texts sent (sms_messages) and two editable
-- canned templates in shop_settings (ready-to-collect, service-due). Texts are
-- sent by the send-sms edge function via Twilio; this only needs the Twilio
-- keys set in Supabase to go live (mirrors how email uses Resend).
-- Placeholders {customer} {machine} {business} {phone} are filled in the app
-- before sending.
-- ============================================================================

create table if not exists public.sms_messages (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  to_phone    text not null,
  body        text not null,
  status      text not null default 'sent',   -- 'sent' | 'failed'
  provider_id text,                            -- Twilio message SID
  error       text,
  sent_by     uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.sms_messages enable row level security;

create policy staff_all on public.sms_messages
  for all using (is_approved_staff()) with check (is_approved_staff());

create index if not exists sms_messages_customer_idx on public.sms_messages(customer_id);

-- Editable text templates (body only — SMS has no subject line).
alter table public.shop_settings add column if not exists sms_ready_body text;
alter table public.shop_settings add column if not exists sms_due_body text;

update public.shop_settings set
  sms_ready_body = coalesce(sms_ready_body, 'Hi {customer}, your {machine} is ready to collect at {business}. Any questions, give us a call on {phone}. Cheers, Craig'),
  sms_due_body   = coalesce(sms_due_body, 'Hi {customer}, it''s Craig at {business}. Your {machine} is about due for a service — call or text {phone} to book it in. Cheers')
where id = 1;
