# Betterservice — decisions & traps

**What this is.** Why the app is the way it is: choices made and what they were
made over, things that were built and then abandoned, and faults that bit us and
what stops them now.

**What this is not.** A changelog. `git log` already holds what changed and when,
and the commit bodies on this project are unusually full — read them. This file
holds the reasoning that outlives any one commit, and the things you would
otherwise have to rediscover the hard way.

Written 19 Sep 2026 from all 156 commits (10 Jul – 19 Sep), the 70 migrations and
the code comments. Every claim here was checked against the code or the live
database at that date. Where something could not be checked, it says so.

---

## Read this part even if you read nothing else

Nine rules, each one paid for.

**1. A click handler that can throw must say so.** An unhandled throw inside an
`async` onClick is completely invisible — no message, and the button sits on
"Sending…" forever. Found on the invoice page (`e79c85f`, 3 Sep), fixed there,
and then found again two weeks later in its copy-pasted twin on the job card
(`ec94f64`, 17 Sep), where it meant **Approve & send did nothing at all**.
try/catch/finally, and show the error.

**2. A scheduled job that returns 200 has not necessarily done anything.** The
nightly reminder job called Twilio for a year. Twilio was never set up. Every
night it woke, answered "Twilio isn't set up yet", returned HTTP 200 and went
back to sleep. Nobody knew (`d5aee7b`, 2 Sep). Same shape twice more: a de-dup
stamp whose write was never checked (`b47b44c`, 10 Sep), and an early `return`
that skipped everything below it on the majority of days (`9936e1a`, 17 Sep).
**Anything unattended needs a `?dry=1` mode and needs to report into something a
human reads.**

**3. Never claim something was sent unless it was.** The thread running through
the last three weeks of this project. An invoice could be filed, marked sent, and
the email rejected — the shop's records say sent, the customer has nothing, and
nobody finds out until the money is late. Guarded now on the server
(`send-invoice` marks sent only if Resend accepted) **and** in the browser (both
callers honour `res.emailed` instead of marking sent regardless). The same fault
turned up in the documentation, which said rent auto-sends when it waits for
approval (`3d299e7`, 19 Sep).

**4. A fact written only by the browser is a fact you will lose.** The machine's
service date was stamped inside `approveAndSend()` and nowhere else, so it
recorded only if someone clicked all the way through and the email went and the
page didn't error — every machine in the shop read "never serviced" (`b9f60ba`,
2 Sep). Pick-up details lived in browser memory, were assembled into a text and
thrown away (`15a8a68`, 17 Sep). **If it matters, a trigger or an RPC writes it.**

**5. Supabase is live, and the repo is a claim about it.** Six times now,
something existed in production and not in version control: migrations
reconciled after the fact (15 Jul), `parts.cost_price` added by hand in the SQL
editor, `email_log` applied from a copy in ~/Downloads, a supplier-payment
trigger, `send-invoice` two versions behind, and `resend-webhook` deployed and
ACTIVE for ten days with no source in the repo at all. **Change it in the
dashboard, bring it back the same sitting.** The closing convention: pull the
production version down, commit it with a header saying where it came from, make
the migration idempotent.

**6. A shared list exists to stop a split — don't bypass it from one screen.**
A literal `"115"` defeating the shop-rate fallback; a make/model list trapped
inside one page; `days_3` missing from the terms list; `"bank"` seeded by the
very page that imports `PAYMENT_METHODS`. Each time, one screen quietly disagreed
with the others.

**7. Check whether you can edit what you can create.** Reported twice by Craig,
then swept systematically (`74a6719`, 16 Sep): every table the app can INSERT
into was checked against what it can UPDATE. Five more places let you create a
record and never correct it. **New screen: ask the question before shipping.**

**8. Craig works on an iPad, at a bike, one-handed.** A 3.5 MB post it wouldn't
make; `capture="environment"` hiding the photo library; `hover:` styling that
gives no touch feedback; suggestion dropdowns covering the box; `doc.save()`
raising a download prompt mid-handler and killing the send; sixteen cards making
one long scroll. **Assume touch, small screen, poor signal, mid-job.**

**9. A public fact kept in four places will be wrong in at least one.** Opening
hours shipped wrong into three copies in a day, and a fourth was then found on
the Google Business Profile — the one we don't control. Same with redirect URLs
guessed rather than checked against Search Console.

---

## Decisions

Newest first. **Superseded entries are kept, marked, and point at what replaced
them** — a ledger that quietly drops its wrong answers teaches nothing.

| Date | Decision | Chosen over | Why |
|---|---|---|---|
| 19 Sep | Owner-only numbers gated at the **count**, not at the display row | Gating each row | One gate feeds both the tile badge and the attention row, so they can't disagree about who may see a figure |
| 17 Sep | Pick-up dispatch sends **push *and* email** | Either alone | Push is instant with an Open-in-Maps button; the email is what's still there an hour later. Neither failure blocks the other |
| 17 Sep | The service worker caches **nothing**, on purpose | Normal offline caching | "An offline cache on an app showing live stock and invoices would serve stale numbers that look current" |
| 16 Sep | Workshop invoices due in **7 days** | The 20th of the month following | *Supersedes the 28 Aug default* |
| 16 Sep | Invoice delete exists, and is **distinct from** a credit note | Credit-note-only | A test or duplicate invoice was never real; crediting it leaves a lie on the ledger. Behind a type-the-number confirmation |
| 16 Sep | Payment corrections are **insert-then-delete**, never UPDATE | An update policy | `payments`/`supplier_payments` keep integrity through INSERT and DELETE triggers only. Insert first, so a failure loses nothing |
| 16 Sep | Rent wording asks to be paid, says an AP is **preferred** | "Collected by automatic payment" | It wasn't true of every tenant |
| 10 Sep | Margin shows blank, not 0%, when no cost is entered | Showing 0% | "Claiming 100% margin on an unset cost is a lie the page shouldn't tell" |
| 9 Sep | The **owner sets staff passwords**; no self-service reset | Self-service email reset | *Supersedes the 30 Aug reset flow.* The `/reset` page survives on purpose |
| 9 Sep | Search runs **as the signed-in user** | A privileged search RPC | "Row level security still decides what comes back — this is a faster way to the same rows, not a new way into the data" |
| 8 Sep | **No prices on public Betterservice pages** | Publishing them | Ben's rule. Also: pricing that can never go stale |
| 8 Sep | **No cross-domain canonical** to flipbikes.co.nz | Canonicalising | "That would drop this page out of search entirely and throw away the ranking the redirect exists to preserve" |
| 3 Sep | Rent is **prepared and then waits for a human** (`sent = false`) | Generate-and-email in one breath | *Supersedes 30 Aug.* See T-rent below |
| 2 Sep | Rent periods follow **each tenancy's own start date** | Calendar months, all billed on the 1st | *Supersedes 30 Aug.* Seven different start days are in use |
| 2 Sep | The machine's service date is stamped by a **database trigger** on invoice creation | Browser-side stamping | *Supersedes the original.* `greatest()` so the date only moves forward |
| 30 Aug | Rent runs **daily**, with a ±3-day window | Monthly | "A once-a-month job that fails is a month of rent never invoiced." A failed run heals itself next morning; a unique index on (agreement, period) makes double-billing impossible |
| 30 Aug | Rental rates stored **GST-inclusive** — the opposite convention to job cards | Matching job cards | The agreed rent is the number on the agreement. GST is extracted at 3/23 rather than added at 15% |
| 21 Jul | Stock movement is **atomic in the database** | Read-modify-write in the browser | Concurrent use corrupted counts. `select … for update` plus the arithmetic in one transaction |
| 21 Jul | Invoice totals computed **server-side**, then frozen | Trusting browser totals | A lock trigger refuses edits to lines once an invoice exists |

---

## Do not rebuild these

**Texting / Twilio — closed, not pending.** Built in July (reminders, pick-up
dispatch, `sms_messages`, `send-due-reminders`, an entire OPERATIONS section).
Killed 17 Sep: *"in two years not one text was ever sent."* The reason it can't
simply be switched on: **NZ carriers reject alphanumeric sender IDs and overseas
long codes for application traffic.** A dedicated short code is the only route —
roughly five to six weeks and hundreds of dollars a month. Checked Sep 2026.
Replaced by web push + email. `send-sms`, `sms_messages` and
`due_for_sms_reminder()` survive deliberately, costing nothing, as a starting
point if that ever changes. **Nothing in the app calls them. Do not buy a Twilio
account on the strength of an old doc.**

**Parts requests** (job-card request → Craig's queue → one-click PO). Built 17
Jul, replaced 31 Aug by "parts ordered in": cost entered, charged at cost +
markup. `0018_part_requests.sql` and the table are still in the tree and there is
**no page** — don't mistake them for live. No commit explains why the queue model
lost, which is itself worth knowing.

**Self-service password reset.** Built 30 Aug, removed 9 Sep.

**Storage `upsert` on photo uploads.** The upsert was *why* the failing statement
needed UPDATE permission the bucket doesn't grant. Dropped instead — the path
already carries a timestamp and a random suffix, so there is never a conflict.
Both halves were needed: removing upsert alone still failed on `RETURNING`.

**`capture="environment"` on the For Sale photo input** — it sends a phone
straight to the rear camera and hides the photo library. Deliberately **kept** on
the job card, where the mechanic is standing at the bike.

**Machine make/model suggestion dropdowns** — they popped up over the box on the
iPad. The reference list in `lib/machineOptions.js` survives; nothing is wired to
it.

**WebP share images.** Facebook and X read them; LinkedIn, Slack and Signal don't
— a shared link with no picture. 1200×630 JPEG, and the rule is written into
`lib/seo.js`.

**DNS domain-property verification for Search Console.** Needed a TXT record at
HostPapa for visibility into a transition already verified as working. Using a
URL-prefix property via `metadata.verification.google` instead — **do not remove
that token, it un-verifies the property.**

---

## Traps, and what stops them now

The ones worth carrying forward. Roughly thirty were catalogued; these are the
ones whose guard you could accidentally remove.

- **Deleting an invoice silently deleted its payment.** `payments` cascades from
  `invoices`; `credit_notes` does not (it refuses); `email_log` sets null. The
  delete panel spells this out before you confirm.
- **Order matters when saving invoice dates.** `trg_invoice_due_date` fires on
  `insert or update of issued_date, payment_terms` — so a hand-set due date
  alone survives, but writing the issue date *after* it recomputes and overwrites
  it. `saveDates()` writes issue first, due second, in separate statements. The
  comment above it says "ORDER MATTERS HERE". It does.
- **A week's rent went out in the monthly box, emailed before anyone looked.**
  That $115 invoice is why rent now stops for approval.
- **Six of seven tenancies would never have been billed for their first month**
  under calendar-month periods.
- **A 2.6 MB invoice PDF that was 2.6 MB of logo.** Two fixes, both needed:
  downscale to target DPI *and* Flate compression.
- **Photo uploads had never worked in either bucket, ever** — the buckets granted
  INSERT and DELETE but not SELECT, and `RETURNING *` needs SELECT.
- **Invoices were addressed to the person, not the company that pays.**
- **Backend functions leaked customer data to anyone holding the public key** —
  and then the grants that fixed it silently reverted, which is why they're now
  recorded in a migration rather than set in the dashboard.
- **Mechanics could see what the shop owes its suppliers** (19 Sep). Caused by
  the dashboard rework the day before: `attention_summary()` is gated on
  `is_approved_staff()`, **not** on owner, so the database hands those numbers to
  any logged-in mechanic. The old cards hid them by being owner-only; a single
  shared attention list had no such protection.
- **"Sent by" never defaulted to the signed-in person**, because the staff query
  didn't select `email`, so the match always failed. The comment claimed
  otherwise for weeks.

---

## Known stale, as at 19 Sep 2026

Recorded here rather than fixed silently, so nobody trusts them in the meantime.

- **`ARCHITECTURE.md` is badly out of date and it is the file `AGENTS.md` tells
  every agent to read first.** Last touched 18 Jul. It contains **zero** mentions
  of rentals, tenancies, hireage, `email_log`, `push_subscriptions`,
  `invoice_line_items`, bookings or dispatch — that is, everything built from 30
  Aug onward, roughly migrations 0042–0070. It still says "29 tables" (there are
  38) and still credits SMS with the service reminders. **Highest-value doc fix
  outstanding.**
- **`DOMAIN-MOVE.md`'s redirect table is behind the code.** It lists
  `/bosch-batteries.php` only; the URL Google actually had indexed was
  `/Neuton-Power-Batteries.php`, found in Search Console on 16 Sep and now in
  `next.config.mjs` (matching is case-sensitive). The same table still says the
  FLIP mounts page is a **decision to make** — it was made, and the page exists.
  Rebuild the redirect list from that doc and you reintroduce a 404.
- **`0043_rentals.sql`'s header describes the abandoned rent scheme** — calendar
  months, ten units, "collected by automatic payment". Migrations are historical
  records so it stays, but it is the first hit when grepping for the rent rule,
  and `0061` doesn't say it supersedes it.
- **A stale comment at `app/jobs/[id]/page.js:69`** still says pick-up dispatch
  texts. It doesn't.
- **`monthly-statements` is scheduled but inactive.** `send-statements` works;
  the schedule is switched off. If statements are meant to go out, that's why
  they aren't.
- **Push notifications have never fired.** The VAPID keys were generated but not
  installed — `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in Vercel (**then redeploy**, it's
  baked in at build time) and three secrets in Supabase. Until then the email
  half of dispatch works alone.
- **The drift count was wrong in the commit that added `resend-webhook`.** It
  called itself "the fourth"; it is at least the fifth by the project's own
  numbering and the sixth counting the July reconciliation. The file header is
  corrected. The commit message stays wrong — rewriting pushed history is worse
  than a wrong number in a log.
- **`resend-webhook/index.ts` is a transcription of the deployed source**, not a
  byte-verified copy. Until someone deploys *from* it, production is the
  authority.

---

## Adding to this file

One entry when: a choice was made between real options; something was tried and
abandoned; or something failed in a way that wasn't obvious and is now guarded.
Not for routine work — git has that.

Date it, say what it was chosen *over*, and quote the reasoning rather than
paraphrasing it. If an entry here is later reversed, **mark it superseded and
point at what replaced it** instead of deleting it. The wrong turns are half the
value.
