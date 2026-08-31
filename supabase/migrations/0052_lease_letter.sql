-- ============================================================================
-- Betterservice ATV — the lease letter (31 Aug 2026)
--
-- Craig's welcome-and-conditions letter, sent once with a tenant's FIRST rent
-- invoice. It lives in Settings as editable text rather than in the code,
-- because a document like this gets reworded and shouldn't need a deploy.
--
-- Placeholders, same {name} style as the invoice email templates:
--   {customer} — the tenant's name
--   {unit}     — the unit or shed they're taking
--   {date}     — the invoice date (what the letter calls the move-in date)
--   {start}    — the tenancy start date, if that suits better than {date}
--
-- An agreement with lease_pdf_path set uses THAT file instead — so a signed or
-- lawyer-drafted version always beats the generated one.
--
-- Idempotent: safe to re-run.
-- ============================================================================

alter table public.shop_settings
  add column if not exists lease_letter_body text;

update public.shop_settings
   set lease_letter_body = $letter$Hi {customer},

Please find invoice for storage unit {unit} attached with bank details on invoice.

Once payment cleared you may move in when suits.

Official move in date will be the {date}, we will enter a code for the gate for after hours access and a code in the alarm for your unit. You will then be provided with a key fob for the alarm arm and disarm, this will allow for access to your unit only.

Notes: Privacy and Security of the Storage site is very important! By paying the lease you are accepting the following conditions:

1. I will pay the lease by Automatic payment each month in advance on the 28th of the month.
2. I am responsible to make sure that the gate is closed after entering or leaving the property.
3. I am responsible for my alarm code and the key fob, these are unique to me, should I lose it I will be charged a $75 fee for another.
4. I will respect other users of the site and make sure that I do not do anything to cause offence to others.
5. I will notify the landlord immediately of any damage to the landlords property or any concerns so these can be dealt with quickly.
6. I agree to pay for any damage I have caused and if I fail to pay my lease by the due date I know that I will expected to vacate immediately.

Kind regards

Craig Barrett
Manager
Betterservice ATV Te Puke
556 Te Puke Highway, Te Puke 3187
(021) 08327787
www.betterservice.co.nz

Better bikes, Better price, Better advice, Better service$letter$
 where lease_letter_body is null;
