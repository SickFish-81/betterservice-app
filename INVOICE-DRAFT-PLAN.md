# Editable invoices — draft until confirmed

**Status:** plan only. Nothing built. Written 30 Sep 2026 after Craig asked to be able
to edit an invoice before hitting confirm and send.

**Decisions already taken (Ben, 30 Sep):**
- Draft until confirmed, not "amend while unsent" and not an automated discard.
- **Printing issues the invoice.** A printed document in a customer's hand is a tax
  invoice, so printing assigns the number, posts to the ledger and locks it, exactly
  as emailing does.

---

## Why he can't edit today

Three locks, all deliberate, stacked:

1. **`trg_job_line_items_lock`** (migration 0028) — the database refuses any insert,
   update or delete on a job's labour and parts the moment an invoice exists for that
   job. *"This job has an invoice — labour & parts are locked. Discard the invoice first."*
2. **`lock_invoice_money`** (0036 / 0037) — subtotal, GST and total can never change
   after the invoice row is created.
3. **`generate_invoice()`** (0035) derives those totals server-side from the job lines
   and the ledger posts on insert.

Editable today: issue date, due date, payment terms, recipient email, sent-by. Nothing else.

### The real cost of the current workaround

`invoice_number` is a Postgres **generated identity** column. Discarding an invoice does
not give the number back. Every correction burns a number permanently and leaves a gap in
the sequence. For a GST-registered business that is exactly what an IRD auditor asks about.
Craig feels this as friction; the numbering is the part that actually matters.

The accounting side is already handled correctly — deleting an invoice reverses its journal
entries as a `Void: …` audit trail (migration 0030). Discarding is lossy, not dangerous.

---

## Two structural facts that shape the build

**Workshop invoices have no line items of their own.** The PDF reads `job_line_items`
live off the job card on every render. Rental and hireage invoices *do* carry their own
`invoice_line_items`. "Edit the invoice" therefore means two different things.

**There are three creation paths, not one:**

| Path | Entry point | Review step today |
|---|---|---|
| Workshop | `generate_invoice(p_job_id)` — job card | none — this is Craig's complaint |
| Hireage | `generate_hire_invoice(p_hire_id)` | none |
| Rental | `generate-rental-invoices` edge function (v17) | Rentals → Approvals tab |

---

## Scope: workshop only in phase 1

Rentals already have an approvals tab where Craig reviews before sending. Hireage is
low-volume. So hireage and rental generation will **call `finalise_invoice` immediately**,
making their behaviour byte-identical to today. The draft flow proves itself on the one
path Craig actually complained about, and the blast radius stays small.

---

## Database — one migration, `0073_invoice_drafts.sql`

1. `alter table invoices alter column invoice_number drop not null` — a draft has no number.
2. Add `finalised_at timestamptz` and `finalised_by uuid references staff(id)`.
   **Draft is `finalised_at is null`** — explicit, not inferred from a null number.
3. **Backfill every existing row**: `finalised_at = coalesce(sent_at, created_at)`.
   Miss this and the entire existing book silently becomes drafts.
4. Add the unique index that 0066's comment already assumes exists but doesn't:
   `create unique index … on invoices (invoice_number) where invoice_number is not null;`
5. **Move the ledger posting** off insert. Drop `trg_ledger_invoice_insert`; add
   `trg_ledger_invoice_finalise` firing `after update of finalised_at`
   `when (old.finalised_at is null and new.finalised_at is not null)`.
   The existing `ledger_on_invoice_insert()` body is reused unchanged.
6. **Relax `lock_invoice_money`** so it only bites once finalised — totals move freely
   while draft, and are frozen forever after.
7. **Relax `enforce_job_line_items_not_invoiced`** to test
   `… where job_card_id = v_job and finalised_at is not null`. New message:
   *"This invoice has been issued — credit it to change the parts."*
8. **New trigger on `job_line_items`**: after insert/update/delete, if that job has a
   draft invoice, recompute its subtotal / GST / total from the lines. Keeps the stored
   figures honest while Craig edits.
9. **New RPC `finalise_invoice(p_invoice_id)`**, security definer, search_path pinned:
   - guard on `is_approved_staff()`
   - re-derive the totals one final time from source of truth
   - assign `invoice_number` from the identity sequence
   - set `finalised_at`, `finalised_by`
   - **idempotent** — if already finalised, return the row untouched rather than
     double-posting to the ledger
10. `generate_invoice()` inserts with `invoice_number = null`, `finalised_at = null`.
    `generate_hire_invoice()` and the rental function call `finalise_invoice()` inline.

---

## App changes

- **`lib/invoicePdf.js`** — `invNo(null)` currently renders `0000`, so a draft would print
  `TAX INVOICE #0000`. A draft must render **"DRAFT — NOT A TAX INVOICE"** with no number.
  Non-negotiable: a draft PDF must never be mistakable for a tax invoice.
- **`app/invoices/[id]/page.js`** — while draft, show editable lines with a live total and
  a **Confirm & issue** button. After finalising, the page behaves exactly as it does now.
- **Print path must finalise first**, per the decision above.
- **`app/jobs/[id]/page.js`** — lock messaging changes; Discard still works on a draft.

---

## Sleeper risks — drafts must not count as money owed

This is the part most likely to go wrong quietly. A draft defaults to `status = 'Unpaid'`,
so unless each of these is filtered on `finalised_at is not null`:

- **`outstanding_statements()`** would put drafts in customer statements and the debtor book
  (the $11,656.38 / 14 invoices figure comes from this path).
- **`accounting_overview()`** would count drafts as receivables.
- **`invoices_unsent`** (just touched in 0072) would nag Craig about invoices he hasn't finished.
- **`app/invoices/page.js`** and the dashboard need a visible Draft state, not a silent one.

## Verification before it ships

Per the usual approach: build each trigger and the new RPC against the live database inside
a transaction that is rolled back, and confirm specifically that
(a) an existing sent invoice still reads as finalised after the backfill,
(b) a draft never appears in `outstanding_statements()`, and
(c) calling `finalise_invoice` twice posts to the ledger exactly once.

---

# Built and verified — 30 Sep 2026

`supabase/migrations/0073_invoice_drafts.sql` is written but **NOT applied**.
Verified against the live database inside a transaction that was rolled back;
afterwards `finalised_at` does not exist, `invoice_number` is still an identity
column, the sequence is still at 1051 and `trg_ledger_invoice_insert` is intact.

## Four things the plan got wrong, found while building

1. **Postgres will not drop NOT NULL on an identity column.** The identity has to
   be dropped first, and dropping it takes its sequence — and the high-water mark
   — with it. The migration now reads `last_value` beforehand and restores it into
   a plain sequence of the same name, owned by the same column, so numbering
   continues from 1052 unbroken.
2. **Rentals were missed entirely.** `generate_rental_invoice` was left creating
   drafts. Because `invoices_unsent` now requires `finalised_at`, every rental
   would have vanished from the Rentals → Approvals tab and simply never been
   sent. It now issues inline, like hireage.
3. **`finalise_invoice` has to accept `service_role`.** The nightly rental run has
   no signed-in staff member behind it, so an `is_approved_staff()`-only guard
   would have failed the moment it tried to issue.
4. **The backfill was not safe to re-run.** Without an `invoice_number is not null`
   guard, a second run would sweep up genuine drafts, stamp them finalised and —
   with the finalise trigger by then in place — post them to the ledger with no
   number, giving a journal memo of `Invoice #` and nothing after it.

## Two things the plan over-stated

Checked rather than assumed; neither needs changing:

- **`accounting_overview()`** reads the ledger only, and drafts never post to it.
- **`attention_summary()`** counts `sent = true`, which a draft never is.

Only `outstanding_statements()` and `invoices_unsent` actually needed the filter.

## Test results (22/22)

Backfill leaves no existing invoice as a draft · numbering high-water mark kept ·
new invoice has no number · is a draft · correct total at birth · posts nothing to
the ledger · absent from the unsent list · absent from the debtor book · its lines
CAN be edited · total follows the edit · issuing assigns 1052 · stamps finalised_at
· freezes the edited total · posts exactly one ledger entry · issuing twice still
one entry · twice keeps the same number · issued invoice appears on the unsent list
· ledger debits the right amount · lines locked after issue · totals locked after
issue · rental GST not recomputed (no one-cent drift) · rental takes the next number.

The `is_approved_staff()` / `is_owner()` guards were stubbed for the test run only:
the MCP connects as `postgres`, which cannot satisfy them. Those guards are
unchanged from what already ships.

## Not yet done

The app half: the draft PDF ("DRAFT — NOT A TAX INVOICE", no number), the editable
line items on the invoice page, Confirm & issue, and finalising before print.

---

# APPLIED — 1 Oct 2026

Applied to the live database as migration `20261001063744_invoice_drafts`.

Verified afterwards: the executable SQL stored by Supabase is byte-identical to
`supabase/migrations/0073_invoice_drafts.sql` — 388 code lines, md5
`b74293f820fd4452cfba72b962f8fd7a` on both sides. Only comment text differs.

Post-apply state: all 41 existing invoices carry `finalised_at` (none became a
draft) · `invoice_number` is no longer an identity column and is nullable ·
sequence still at 1051, so the next number issued is 1052 · partial unique index
present · `trg_ledger_invoice_insert` gone, `trg_ledger_invoice_finalise` in
place · draft-totals resync trigger on `job_line_items` · `finalise_invoice`
present.

The 20-assertion behavioural suite was re-run against the applied objects inside
a rolled-back transaction: 20/20 pass.

**Debtor book note.** It now reads 13 invoices / $10,556.12, against the
14 / $11,656.38 recorded in September. This is NOT the migration: running the
same query with and without the `finalised_at` filter gives the identical
13 / $10,556.12. Twelve payments totalling $7,566.11 were recorded in the week
before the migration — Craig has simply been getting paid.

## Still to do — the app half

Nothing in the UI knows about drafts yet, so right now a workshop invoice is
created as a draft and there is no button to issue it. **The app changes are not
optional follow-up; until they land, workshop invoices cannot be sent.**

1. `lib/invoicePdf.js` — `invNo(null)` renders `0000`, so a draft currently
   prints `TAX INVOICE #0000`. Must render **DRAFT — NOT A TAX INVOICE**, no number.
2. `app/invoices/[id]/page.js` — editable lines while draft, live total,
   **Confirm & issue** calling `finalise_invoice`.
3. Print path must call `finalise_invoice` first (printing issues it).
4. `app/jobs/[id]/page.js` — lock messaging now says "issued", not "has an invoice".
