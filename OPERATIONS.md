# Betterservice — operations & things to keep an eye on

The outside services the app depends on, what to check on each, and where every
key lives. Companion to `README.md` and `ARCHITECTURE.md`.

*Note: exact limits and whether pausing/trial rules apply depend on the plan tier
of each account — check each dashboard for current usage and billing. This lists
what to watch, not your current numbers.*

---

## 1. Switching on texting (Twilio)

The `send-sms` function is built and deployed; it just needs a Twilio account and
three secrets before it can actually text. Steps:

1. **Create a Twilio account** at twilio.com.
2. From the **Console dashboard**, copy your **Account SID** and **Auth Token**.
3. **Get a sender that can text NZ mobiles** — either:
   - buy a **Twilio phone number** (SMS-capable), or
   - register an **Alphanumeric Sender ID** (e.g. "Betterserv") — tidy for one-way
     texts like pick-up dispatch and reminders. Note: recipients can't reply to an
     alphanumeric sender.
4. **Enable New Zealand** under Messaging → Geo permissions (so texts to NZ go
   through).
5. **Add three secrets in Supabase** (Project Settings → Edge Functions → Secrets,
   or `supabase secrets set`):
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM` — your Twilio number in `+64…` form, or your Sender ID
6. **Test it**: on a job card, set *Picked up by* to someone who has a phone number,
   fill in the address/time/notes, and hit **Text pick-up details**.

**Watch out for:**
- **Trial mode** only texts numbers you've verified and adds a trial prefix — add
  funds / upgrade to text any customer or staff number.
- **Pay-as-you-go**: roughly a few cents per SMS to NZ mobiles — keep some credit
  on the account or texts silently stop.

---

## 2. Services to keep an eye on

### Supabase — database, logins, storage, functions
Project `vdwssiefdhmepdgkuoxd` (ap-southeast-1). The source of truth for all data.
- **Don't let it pause** — on the free plan a project pauses after ~1 week of
  inactivity, which takes the app down. Regular use or a paid plan avoids this.
- **Storage** — the `job-photos`, `invoices` and `listing-photos` buckets grow over
  time; keep an eye on usage.
- **Database size & egress** vs your plan.
- **Edge function logs** — `send-invoice`, `send-reminder`, `send-sms`,
  `send-purchase-order`, `send-statements`. Errors show up here.
- **Secrets are set** (see the map below).
- **Backups** — paid plans back up automatically; on free, take your own now and
  then (the `supabase/migrations` files are your schema; data is separate).

### Twilio — texting
- **Account balance/credit**, per-message cost, and the **delivery/error logs**.
- The **sender number or ID** staying active, NZ enabled, and out of trial mode.

### Resend — email
Sends invoices, reminders, statements and POs from `accounts@betterservice.co.nz`.
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
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | sending SMS | Supabase → Edge Function secrets |
| `CRON_SECRET` | protecting the scheduled statements/reminders | Supabase → Edge Function secrets |
| Supabase **service role key** | server-side jobs (e.g. statements) | Supabase (never in the app or repo) |

Rule of thumb: anything starting `NEXT_PUBLIC_` is safe in the app; everything else
is a server secret and must never end up in the repo.

---

## 4. Automated SMS reminders — nearly there

The `send-due-reminders` function is built and deployed. To switch it on:

1. Set the **Twilio** secrets (section 1 above).
2. **Schedule it daily** — in Supabase, add a Cron schedule that calls the
   `send-due-reminders` function once a day (e.g. 9am) with the header
   `x-cron-secret: <your CRON_SECRET>` (the same secret your statements job uses).

It texts up to `reminders_per_day` (set in Settings) of the most-overdue machines —
12–18 months since last service, with a phone, reminders not turned off — using the
editable `sms_due_body` template, and stamps each one so no one's texted twice a
cycle. The manual **pick-up text** (`send-sms`) is already wired on the job card.

---

*Keep this updated as services or keys change.*
