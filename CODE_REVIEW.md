# Code Review — betterservice-app

*Reviewed 21 July 2026 by the project's `coder-reviewer` agent. The three Blocker
items and the "no tests / no lint" findings were independently verified against the
source before this was written up; the Medium/Nitpick items are the reviewer's
findings, each tied to a real file so you can check them yourself.*

---

## Overall verdict

This is a genuinely solid piece of work for what it is — a fast-moving small-team
build of a real business system. The double-entry ledger is the standout:
balanced-entry enforcement, idempotent triggers, proper NZ timezone handling, and
clean reporting functions show real care. Row-Level Security is enabled on **all 29
tables** with a consistent three-tier model (public / staff / owner) — nothing is
left wide open at the table level. Multi-step money/stock work mostly goes through
atomic `SECURITY DEFINER` functions, edge functions re-check permissions
server-side, and secrets are handled cleanly (nothing hardcoded, `.env.local`
gitignored). The code is unusually consistent and readable for a project this size.

That said, it is **not yet production-hardened**: two backend functions leak real
customer data to anyone with the public key and no login, a storage-permission gap
could expose private invoice PDFs, there's a real stock-count race condition, and
there are zero automated tests protecting the money logic. None of these need an
architecture rewrite — they're specific, fixable gaps in an otherwise sound design —
but the data-leak ones should be fixed before this handles real customers at scale.

---

## Blocker — fix these first

### 1. `outstanding_statements()` leaks every customer's name, email and unpaid-invoice detail
**File:** `supabase/migrations/0003_accounting_core.sql:331–362` · **Verified ✓**

The function has no permission check inside it, and the migration never removes
Postgres's default "anyone can run this" permission. So even though the app only
calls it from a locked-down scheduled job, anyone who can send a request to your
Supabase project (using the public key that already ships in your website's code)
can call it directly and get back every customer's name, email, and unpaid invoices
with amounts. Its siblings (`accounting_overview()`, `financial_report()`,
`balance_sheet()`) all correctly do `if not is_owner() then raise exception`. This
one is missing that line.

**Fix:** add `if not is_owner() then raise exception 'Owners only'; end if;` inside
the function (convert it from `language sql` to `language plpgsql` to match the
others), and add `revoke execute on function public.outstanding_statements() from public;`.

### 2. `due_for_sms_reminder()` leaks customer names and phone numbers with no login at all
**File:** `supabase/migrations/0015_service_reminder_automation.sql:15–36` · **Verified ✓**

Same root cause as #1, but this one has no explicit grant either, so it falls back to
Postgres's default of being callable by *everyone* — including the anonymous role.
Anyone with your site's public key can ask "who's due for a service" and get real
names and phone numbers back.

**Fix:** add an `is_approved_staff()` guard inside the function (convert to `plpgsql`,
or filter with `where is_approved_staff() and ...` the way `timesheet()` does), plus
`revoke execute ... from public`.

### 3. The private invoices storage bucket is readable by any logged-in account
**File:** `supabase/migrations/0001_schema_baseline.sql:258–276` · **Verified ✓**

Your *table* data is well protected, but the rules for the file *storage* buckets only
check "is this person logged in" — not "are they staff." The `invoices` bucket holds
real customer PDFs (amounts, address, GST number, bank account) and is meant to be
private. If Supabase's "allow anyone to sign up" setting is on (the default), a
stranger could create an account and then read, overwrite, or delete every invoice
PDF you've filed — without passing your staff-approval screen.

**Fix:** (a) in the Supabase dashboard, Authentication → Providers → Email, confirm
"Allow new users to sign up" is **off**; and (b) rewrite the storage policies to also
require staff, e.g.
`create policy invoices_read on storage.objects for select to authenticated using (bucket_id = 'invoices' and is_approved_staff());`
(repeat for write/update/delete and the two photo buckets).

---

## High-Priority

### 4. Adding/removing a part on a job can corrupt stock counts under normal concurrent use
**File:** `app/jobs/[id]/page.js:169–191` (`addPart`, `removeItem`)

The code reads the current stock into the browser, does the math in JavaScript, and
writes it back. If two staff touch the same part at nearly the same time (normal in a
workshop), one change silently overwrites the other and the count drifts. The app
already has the right pattern elsewhere (`record_stock_adjustment()`,
`receive_purchase_order()` lock the row and let the database do the arithmetic).

**Fix:** move the adjustment into a `SECURITY DEFINER` function
(`update parts set qty_on_hand = qty_on_hand - p_qty where id = p_part_id`) called via
`.rpc(...)` instead of a client-side read-then-write.

### 5. "Locked once invoiced" is only a UI rule — the database still allows edits
**File:** `app/jobs/[id]/page.js:160–191` vs. the enforced version in `0017_po_items_to_jobs.sql:39–41`

Once a job has an invoice the app hides the add/remove buttons, but nothing stops the
browser sending those requests anyway (a stuck tab, a bug, the console). If it happens,
the job's line items and the invoice total quietly stop matching. The developer already
added this exact guard to `accept_po_item_to_job()` — it just wasn't carried over.

**Fix:** add a check in the RLS policy (or a trigger) on `job_line_items` that blocks
insert/update/delete when an invoice exists for that job.

### 6. Deleting an invoice doesn't undo its ledger entries, and non-owners can delete paid ones
**File:** `app/jobs/[id]/page.js:379–384`; RLS in `0001_schema_baseline.sql:218–219`; unused fix already built as `reverse_entry()` in `0003_accounting_core.sql:158–177`

Any approved staff member (not just an owner) can delete a sent, paid invoice, and the
accounting entries it created stay in the ledger pointing at nothing. The books still
balance technically but no longer reflect reality. The proper tool, `reverse_entry()`,
already exists — it's just never called.

**Fix:** tighten `invoices_delete` to mirror `invoices_update` (block deleting a sent
invoice unless you're a can-send owner), and replace hard deletes with a `reverse_entry()`
call so corrections are visible in the books.

### 7. The busiest page loads 14 queries one at a time instead of together
**File:** `app/jobs/[id]/page.js:86–121` (`load()`); only `app/reports/page.js` does it the fast way

Each query is a separate round trip, and the code waits for each before starting the
next. On the job detail page — opened dozens of times a day — that's real lag, and the
whole set re-runs after every small action (ticking a checklist box, adding a part).

**Fix:** group independent queries with `Promise.all([...])` the way `reports/page.js`
already does. Start here since it's the worst offender and most-used page.

---

## Medium

- **8. Money totals are trusted from the browser** rather than recomputed by the
  database (`app/jobs/[id]/page.js:305–310`, `generateInvoice`). Counter sales and PO
  receiving recompute server-side; invoices don't, and `invoices` is also missing the
  `check (total = round(total, 2))` constraint every other money table has. Low risk with
  a small trusted team, but inconsistent.
- **9. Photos of non-public secondhand listings are downloadable by any visitor**
  (`secondhand_photos` read policy in `0001_schema_baseline.sql:246–247`; triggered by
  `app/for-sale/page.js:30–34`). The page only *shows* Available listings, but fetches all
  photos and filters in the browser. Make the photo read policy match its parent table's
  `status = 'Available'` check.
- **10. No automated tests anywhere** (confirmed: no test runner in `package.json`, no
  `*.test.*`/`*.spec.*` files). This app runs real money through a real ledger; several
  bugs above are exactly what a small test suite would catch. Even a few SQL tests on
  `post_entry`, PO receiving, and payment/invoice-status would help.
- **11. No linting configured** (no `.eslintrc*`/`eslint.config.*`, unusual for Next.js).
  Run `npx next lint` to scaffold the default config (React Hooks + accessibility rules).
- **12. No error logging** — `app/error.js` catches errors but logs nothing; no
  `console.error` or monitoring. Field problems leave no trace. Log caught errors; consider
  a free error-tracker tier.
- **13. Edge functions validate *who* calls but not *what* was sent** (all six in
  `supabase/functions/`). Permission re-checks are done well; input shape/length checks
  (email format, SMS body cap, PDF size) are not. Low risk today, worth tightening later.

---

## Nitpick

- `timesheet()`, `post_entry()`, `reverse_entry()` are missing the same `revoke ... from public`
  cleanup as the Blocker functions, but each has an internal check that fails safely — so
  not exploitable, just inconsistent. Worth making uniform so the next new function doesn't
  repeat the real mistake.
- `send-invoice` uploads to `invoices/invoices/2026-07/...` (redundant nested folder) —
  harmless clutter (`supabase/functions/send-invoice/index.ts:47–49`).
- Some icon-only buttons lack `aria-label`s for screen readers (e.g. photo "×" buttons in
  `app/jobs/[id]/page.js:702`, `app/secondhand/page.js:146`), while similar ones elsewhere
  have them.
- A shared error-message state field isn't cleared when a new action starts, so a stale
  error can linger on screen.
- The Staff page only creates the permissions record, not the actual login — an owner must
  separately create the Supabase Auth account with a matching email, and nothing on the page
  says so (`app/staff/page.js`).
- Public marketing pages use plain `<img>` instead of Next.js `<Image>` — misses automatic
  lazy-loading/optimization. Lower priority for the internal back office.

---

## Biggest wins to do first

1. **Lock down `outstanding_statements()` and `due_for_sms_reminder()`** — add the missing
   auth checks and `revoke ... from public`. A few lines of SQL; closes the most serious issue.
2. **Fix the storage bucket policies** to require `is_approved_staff()`, and confirm public
   sign-ups are off in the Supabase dashboard. Closes the invoice-PDF exposure.
3. **Make "locked once invoiced" and stock adjustments atomic in the database** (#4, #5) —
   prevents hard-to-trace stock/invoice mismatches.
4. **Stop deleting invoices outright** — owners-only-when-sent, and wire the existing
   `reverse_entry()` in as the proper "undo."
5. **Parallelize the query waterfall on `jobs/[id]/page.js`** with `Promise.all` — cheap,
   and it's the page your team opens most all day.
