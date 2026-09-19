# Betterservice — operations & things to keep an eye on

The outside services the app depends on, what to check on each, and where every
key lives. Companion to `README.md` and `ARCHITECTURE.md`.

*Note: exact limits and whether pausing/trial rules apply depend on the plan tier
of each account — check each dashboard for current usage and billing. This lists
what to watch, not your current numbers.*

---

## 1. Pick-up dispatch — a notification and an email (texting is off)

**Texting is not happening, and this is not a to-do.** NZ carriers do not accept
alphanumeric sender IDs or overseas long codes for application traffic; a
dedicated short code is the only route, at roughly five to six weeks and
hundreds of dollars a month. That was checked in Sep 2026 and abandoned. The
`send-sms` function and the `sms_messages` table are still deployed but nothing
in the app calls them. Do not buy a Twilio account on the strength of this file.

What replaced it: **`send-dispatch`**, which sends a **web push notification**
to each signed-up phone (with an "Open in Maps" button on the address) **and**
an email, so the details are still there later. Neither failure blocks the
other, and the response says which half landed.

To switch it on, per phone:

1. **Supabase → Edge Function secrets**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
   `VAPID_SUBJECT` (`mailto:admin@betterservice.co.nz`).
2. **Vercel env var**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, **then redeploy** —
   `NEXT_PUBLIC_` variables are baked in at build time, so setting it without a
   new deploy changes nothing.
3. On each phone, open the Dashboard and press **Turn on notifications**. This is
   per DEVICE, not per person: a phone and an iPad both need doing.
4. **On iPhone this only works from the Home Screen.** Safari refuses push to a
   normal tab. Share → Add to Home Screen first, open it from there, then press
   the button — and the press has to be a real tap, not something the page does
   on load.
5. **Test**: on a job card fill in the pick-up address/time/notes and hit
   **Send pick-up details**.

**Watch out for:** a phone that is wiped, reset, or has notifications denied
leaves a dead subscription. The function deletes any subscription the push
service rejects with 404/410, so dead rows clear themselves — but if nobody is
getting notifications, check the Dashboard says notifications are on before
assuming the function broke.

---

## 2. Services to keep an eye on

### Supabase — database, logins, storage, functions
Project `vdwssiefdhmepdgkuoxd` (ap-southeast-1). The source of truth for all data.
- **Don't let it pause** — on the free plan a project pauses after ~1 week of
  inactivity, which takes the app down. Regular use or a paid plan avoids this.
- **Storage** — the `job-photos`, `invoices` and `listing-photos` buckets grow over
  time; keep an eye on usage.
- **Database size & egress** vs your plan.
- **Edge function logs** — the ones that touch money or run unattended matter
  most: `generate-rental-invoices`, `send-rental-invoice`, `send-due-reminders`,
  `send-invoice`, `send-statements`, `resend-webhook`, `send-dispatch`,
  `create-staff-login`, `send-purchase-order`, `send-reminder`. A scheduled job
  that fails does it silently, which is the whole reason to look.
- **Scheduled jobs** (`cron.job` in the database). As at 19 Sep 2026:
  `daily-rent-invoices` 18:00 UTC and `daily-service-reminders` 20:00 UTC, both
  active; `monthly-statements` **exists but is switched off** — if statements are
  meant to go out, that is why they are not. Note the schedules are in UTC, so
  when NZ moves to daylight time they shift an hour later in local terms.
- **Secrets are set** (see the map below).
- **Backups** — paid plans back up automatically; on free, take your own now and
  then (the `supabase/migrations` files are your schema; data is separate).

### Twilio — not in use
Nothing to watch. There is no Twilio account and there should not be one — see
section 1. Listed here only so the next person doesn't go looking for it.

### Resend — email
Carries everything the app emails. Two sender addresses, deliberately:
`accounts@betterservice.co.nz` for workshop invoices, `admin@betterservice.co.nz`
for everything else (rent, reminders, statements, POs, pick-up dispatch). Both
need the domain verified.
- **Delivery status** comes back through the `resend-webhook` function into
  `email_log`, and the Emails screen in the app is the readable view of it. If
  that screen stops updating, suspect the webhook or its signing secret.
- **Sending domain stays verified** — the SPF/DKIM DNS records for
  `betterservice.co.nz` must stay in place, or email quietly stops landing.
- **Monthly send volume** vs your plan, the **API key** being valid, and
  **bounce/spam** rates.

### Vercel — the website hosting
Auto-deploys from the GitHub `main` branch.
- **Each deploy succeeds** — a failed build means the *old* version stays live, so
  check the deploy went green after a push.
- **Environment variables** are set (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- **Bandwidth/usage** vs plan, and the **domain + SSL** pointing correctly.

### GitHub — the code
Repo `SickFish-81/betterservice-app`. The history, and what Vercel deploys.
- Keep pushing changes so nothing lives only on one laptop.
- **Never commit secrets** — `.env.local` is gitignored; keep it that way.
- Consider a second person having access as a backup.

### Domain & DNS — betterservice.co.nz
- **Domain renewal** — don't let it lapse (site + email both depend on it).
- **DNS records** — the ones pointing the site to Vercel, and the Resend email
  (SPF/DKIM) records. SSL is handled automatically by Vercel.

---

## 3. Where every key/secret lives

| Secret | Used for | Lives in |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` | the app talking to Supabase | Vercel env vars (+ `.env.local` locally) |
| `RESEND_API_KEY` | sending email | Supabase → Edge Function secrets |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | signing push notifications | Supabase → Edge Function secrets |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the browser subscribing to push | Vercel env vars — **redeploy after changing** |
| `RESEND_WEBHOOK_SECRET` | verifying delivery reports are really from Resend | Supabase → Edge Function secrets |
| `TWILIO_*` | nothing — texting was abandoned, see section 1 | not set, and should stay that way |
| `CRON_SECRET` | protecting the scheduled statements/reminders | Supabase → Edge Function secrets |
| Supabase **service role key** | server-side jobs (e.g. statements) | Supabase (never in the app or repo) |

Rule of thumb: anything starting `NEXT_PUBLIC_` is safe in the app; everything else
is a server secret and must never end up in the repo.

---

## 4. Service reminders — running, by email

**This is already on.** `send-due-reminders` is deployed and scheduled
(`daily-service-reminders`, 20:00 UTC daily). It needs no Twilio: it **emails**,
through Resend, using the `reminder_email_subject` / `reminder_email_body`
templates in Settings. It has emailed rather than texted since migration 0062.

Who gets one: up to `reminders_per_day` (Settings) of the most-overdue machines
— 12 to 18 months since the last service, customer not marked *no reminders*,
and an email address on file. Each send is stamped so the same machine isn't
chased twice in a cycle.

If they stop: check the cron job is still active, then the function's logs, then
that `RESEND_API_KEY` and `CRON_SECRET` are still set. A machine with no
`last_service_date` is invisible to it — that date is stamped by the database
when an invoice is raised, not when it is sent.

---

## 5. Automatic rent invoices — running daily, approved by hand

`generate-rental-invoices` bills the storage units and the shed — 12 units, 9
live tenancies as at 19 Sep 2026.

**Each tenancy runs on its own dates, not the calendar month.** A tenancy that
started on the 14th is billed the 14th to the 13th, and its invoice is raised
three days before that period starts. There are seven different start days in
use, so there is no one "rent day". Rates are held **GST-inclusive** on the
agreement; the generator extracts GST at 3/23 rather than adding 15%, so the
total is exactly the agreed rent.

**It is already deployed and scheduled** (`daily-rent-invoices`, 18:00 UTC
daily). The steps below are what to check if it is ever rebuilt or moved.

1. **Deploy it** — `supabase functions deploy generate-rental-invoices`.
2. **Secrets** — needs `CRON_SECRET` and `RESEND_API_KEY` (both already set for
   statements). `SUPABASE_SERVICE_ROLE_KEY` is provided by the platform.
3. **Enter the tenancies** under Rentals in the app: unit, tenant, monthly rent,
   start date. Tenants must exist under Customers first, with an email address —
   no email means the invoice is created but not sent.
4. **Dry run first** — add `?dry=1` and it reports exactly what it would invoice
   and to whom, without creating or sending anything:

   ```
   curl -s -H "x-cron-secret: $CRON_SECRET" \
     "https://vdwssiefdhmepdgkuoxd.supabase.co/functions/v1/generate-rental-invoices?dry=1"
   ```

5. **Schedule it daily** — in Supabase, add a Cron schedule calling the function
   once a day with the header `x-cron-secret: <CRON_SECRET>`.

Daily, not monthly, is deliberate: it works a +/- 3 day window around each period
start, so a failed run heals itself the next morning, and the unique index on
(agreement, period) means the same rent can never be billed twice. A once-a-month
job that fails is a month of rent never invoiced.

**Nothing is sent to a tenant automatically.** The generator prepares the
invoice, files its PDF and stops, leaving it `sent = false` in **Rentals →
awaiting approval**. Rent reaches a tenant only when Craig approves it there. If
you are reading this to work out whether tenants have been invoiced: they have
not been, until someone pressed the button.

Each run emails a summary to the `invoice_bcc` address in Settings. Read it as a
request for approval, not a record of what went out. It also lists workshop
invoices that were raised and never sent, which is the one place an invoice
stuck in limbo will show up without anyone going looking.

To stop billing one unit, tick **on hold** on its tenancy, or set an end date. A
tenancy with an end date in the past is never billed again.

---

*Keep this updated as services or keys change.*
