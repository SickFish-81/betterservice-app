-- ============================================================================
-- Betterservice Tepuke — editable email templates (Phase 3d)
-- Built 14 July 2026. Runs after 0001 (shop_settings).
-- Adds owner-editable subject + body templates for the invoice, service-reminder
-- and purchase-order emails, seeded with the current wording. The send functions
-- substitute {placeholders} and fall back to built-in defaults if a field is blank.
-- ============================================================================

alter table public.shop_settings
  add column if not exists invoice_email_subject  text,
  add column if not exists invoice_email_body     text,
  add column if not exists reminder_email_subject text,
  add column if not exists reminder_email_body    text,
  add column if not exists po_email_subject       text,
  add column if not exists po_email_body          text;

update public.shop_settings set
  invoice_email_subject = coalesce(invoice_email_subject, 'Your invoice #{number} — {business}'),
  invoice_email_body = coalesce(invoice_email_body, $tpl$Hi {customer},

Thanks for choosing {business}. Your invoice #{number} for ${total} is attached as a PDF.

Any questions, just reply to this email or call Craig on {phone}.

Cheers,
{business}$tpl$),
  reminder_email_subject = coalesce(reminder_email_subject, 'Time for a service — {business}'),
  reminder_email_body = coalesce(reminder_email_body, $tpl$Hi {customer},

It's Craig at {business}. Our records show your {machine} is about due for its service — it's been roughly a year since the last one.

A regular service keeps it running sweet, safe and reliable. Give me a call or text on {phone} to book it in.

Cheers,
Craig · {business}$tpl$),
  po_email_subject = coalesce(po_email_subject, 'Purchase order #{number} — {business}'),
  po_email_body = coalesce(po_email_body, $tpl$Hi {supplier},

Please find our purchase order #{number} attached as a PDF.

Any questions, just reply to this email or call Craig on {phone}.

Cheers,
{business}$tpl$)
where id = 1;
