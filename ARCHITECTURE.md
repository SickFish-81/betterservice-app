# Betterservice App — Architecture

A map of how this app is put together: the stack, the routes, the database, how
logins and permissions work, and the main business flows. It's written to get a
new developer (or future-you) productive quickly.

Companion docs: `README.md` (what it is + how to run) and `supabase/README.md`
(database notes). This file explains **how the pieces fit together**.

---

## 1. The one-paragraph mental model

Betterservice is a **Next.js app** with a **Supabase (Postgres) backend**. There
is no custom API server. The pages run in the browser, and they talk **directly**
to the database using the public "anon" key. That's safe because Postgres itself
enforces every permission rule through **Row-Level Security (RLS)** — the browser
can only ever see or change what the logged-in user is allowed to. A few jobs that
can't happen in the browser (sending email, building statements on a schedule) run
as **Supabase Edge Functions**. Money is tracked in a proper **double-entry ledger**
that the database keeps in sync automatically whenever an invoice, payment, expense
or credit note is created.

So there are really four moving parts:

1. **Next.js pages** (the screens, in `app/`) — mostly client components.
2. **Supabase Postgres** (the data + the security + the business logic in SQL).
3. **Edge Functions** (email + scheduled jobs, in `supabase/functions/`).
4. **Supabase Storage** (PDFs and photos).

---

## 2. Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | JavaScript (no TypeScript in the app; Edge Functions are TypeScript) |
| Styling | Tailwind CSS v4 |
| Backend | Supabase — Postgres, Auth, Storage, Edge Functions |
| Email | Resend (called from Edge Functions) |
| PDFs | jsPDF in the browser (invoices, POs); pdf-lib server-side (statements) |
| Hosting | Vercel (front end) + Supabase (backend) |

Run locally:

```bash
npm install
npm run dev      # http://localhost:3000
```

Needs a `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Supabase project ref: `vdwssiefdhmepdgkuoxd`
(region ap-southeast-1).

> **Heads-up (see `AGENTS.md`):** this is Next.js 16, which has breaking changes
> vs older versions. Check `node_modules/next/dist/docs/` before assuming an API.

---

## 3. Repo layout

```
app/                 Next.js routes (each folder = a URL) + shared components
  layout.js          Root layout; wraps everything in <AuthGate>
  AuthGate.js        The gatekeeper: login + role checks + which nav to show
  NavBar.js          Back-office top nav (role-aware menus)
  PublicNav.js       Header for the public marketing pages
  RoleContext.js     Shares "is this user an owner?" down the tree (useOwner())
  AttentionBanner.js Shows things needing attention (calls attention_summary())
  TimesheetNudge.js  Reminds staff to log their hours
  <feature>/page.js  One page per feature (jobs, invoices, parts, …)
lib/
  supabaseClient.js  The single shared Supabase connection
supabase/
  migrations/*.sql   The database, versioned as numbered migrations
  functions/*        Edge Functions (send-invoice, send-reminder, …)
  README.md          Database notes
public/              Images, logos, hero video for the marketing site
drafts/              Scratch/experimental components (not wired into the app)
.claude/agents/      Project-specific AI agent definitions
```

---

## 4. Routes & access

Every folder under `app/` with a `page.js` is a URL. Access falls into three
tiers, enforced in **`app/AuthGate.js`** (and backed by RLS in the database):

- **Public** — no login required.
- **Staff** — must be logged in **and** an approved staff member.
- **Owner** — money/admin areas, limited to owners.

### Public
| Route | Purpose |
|---|---|
| `/` | Shop homepage (marketing) |
| `/login` | Email sign-in |
| `/batteries` | Neuton batteries info page |
| `/for-sale` | Public used-ATV gallery |

### Staff (approved login)
| Route | Purpose |
|---|---|
| `/dashboard` | Back-office launcher (big tiles; top nav is hidden here) |
| `/jobs`, `/jobs/[id]` | Job cards — the heart of the app (details below) |
| `/templates` | Checklist templates ("Full ATV Service", etc.) |
| `/customers` | Customer records |
| `/machines` | Machines (bikes/ATVs/SxS) linked to customers |
| `/due` | Machines due for a service reminder |
| `/parts` | Parts catalogue + stock levels |
| `/stocktake` | Adjust/count stock on hand |

### Owner only (money & admin)
| Route | Purpose |
|---|---|
| `/invoices` | Invoices + payments |
| `/credit-notes` | Credit notes against invoices |
| `/counter-sales` | Walk-in point-of-sale |
| `/bills` | Supplier bills / accounts payable |
| `/expenses` | Shop expenses |
| `/accounting` | Ledger overview (balances, income, recent entries) |
| `/reports` | Financial reports (P&L, balance sheet) |
| `/purchase-orders`, `/purchase-orders/[id]` | POs to suppliers |
| `/part-requests` | Staff part requests → turn into POs |
| `/suppliers` | Supplier records |
| `/timesheets` | Hours-worked rollup per person |
| `/staff` | Add/approve staff, set owner + can-send flags |
| `/settings` | Shop details, GST no., email templates |
| `/secondhand` | Manage the used-ATV listings shown on `/for-sale` |

The `OWNER_ONLY` list lives at the top of `app/AuthGate.js`; the nav menus in
`app/NavBar.js` hide owner-only links from non-owners as well.

---

## 5. Auth & roles

**Login** is Supabase Auth (email). `app/layout.js` wraps the whole app in
`<AuthGate>`, which is where access is decided on the client:

1. Get the current session. No session + private page → redirect to `/login`.
2. Look up the user's `staff` row by email. A returned row (with `active`)
   means **approved staff**; `role === 'owner'` means **owner**.
3. Not approved → "Awaiting approval" screen. Owner-only page but not an owner →
   "Owners only" screen. Otherwise render the page.
4. `RoleContext` shares `owner` down the tree; components call `useOwner()` to
   hide money/admin UI.

**The real security is in the database, not the browser.** Because pages query
Supabase directly, RLS is what actually protects data. Three SQL helper functions
(defined in `0001_schema_baseline.sql`) are the backbone:

| Function | True when… |
|---|---|
| `is_approved_staff()` | caller's email matches an active `staff` row |
| `is_owner()` | …and that row's `role = 'owner'` |
| `current_staff_can_send()` | that staff member has `can_send_invoices = true` |

RLS policies then use these, for example:

- Operational tables (customers, machines, job_cards, parts, checklist_templates…)
  → **all** actions allowed to `is_approved_staff()`.
- `invoices` → staff can read/insert/delete, but **once an invoice is `sent`, only
  a can-send owner may update it** (`current_staff_can_send()`).
- `shop_settings`, `staff` → staff read, **owner-only** write.
- `accounts` / `journal_entries` / `journal_lines` → **owner-only read**; all
  writes go through security-definer functions (below), never direct inserts.
- `secondhand_listings` → the public (anon) can read only `Available` listings.

This is **defence in depth**: even if someone bypassed the UI, the database would
still refuse actions they're not allowed to take.

---

## 6. Data model

29 tables. Grouped by what they do:

**People & machines**
`customers` → `machines` (a customer owns machines). `staff` (with `role`,
`active`, `can_send_invoices`). `suppliers`.

**Jobs (the core)**
- `job_cards` — one per job (job number, customer, machine, status, dates, who
  dropped-off/serviced/picked-up).
- `job_line_items` — labour and parts on a job (`kind = 'labour' | 'part'`;
  `amount` is auto-computed as `quantity * unit_price`).
- `job_checklist_items` — the tick-list for a job (label + `done`), seeded from
  a `checklist_templates` row.
- `job_time_entries` — time clocked against a job (feeds timesheets).
- `job_photos` — photos in the public `job-photos` bucket.
- `checklist_templates` — reusable task lists (`name` + `items[]`). **This is the
  "template system"** — the three service checklists live here.

**Sales & money**
- `invoices` — one per invoiced job (subtotal / gst / total, `status`, `sent`,
  `pdf_url` = path in the private `invoices` bucket).
- `payments` — payments against an invoice (drives invoice status).
- `credit_notes` — refunds/adjustments against an invoice.
- `counter_sales` + `counter_sale_items` — walk-in POS sales.
- `expenses` — shop costs (numbered from 10000).

**Accounting ledger** (see §8)
`accounts` (chart of accounts) · `journal_entries` + `journal_lines`
(the double-entry records).

**Inventory & purchasing**
`parts` (`qty_on_hand`, `min_stock`) · `stock_adjustments` · `purchase_orders` +
`purchase_order_items` · `part_requests` · `supplier_payments`.

**Other**
`shop_settings` (single row: business name, address, phone, GST no., bank, email
templates) · `secondhand_listings` + `secondhand_photos` (public gallery) ·
`sms_messages` (reminder log).

Most business rules live in Postgres **functions** rather than the front end, e.g.
`receive_purchase_order()`, `create_po_from_request()`, `accept_po_item_to_job()`,
`create_counter_sale()`, `record_stock_adjustment()`, `timesheet()`,
`balance_sheet()`, `attention_summary()`, `due_for_sms_reminder()`. Calling one
line of SQL keeps multi-step operations correct and atomic.

---

## 7. Key flows

### Job → invoice → payment
1. Create a **job card** for a customer + machine.
2. Apply a **checklist template** (`applyTemplate()` copies its items into
   `job_checklist_items`); the tech ticks items off.
3. Add **labour and parts** as `job_line_items`. Adding a stocked part decrements
   `parts.qty_on_hand`; removing it puts stock back.
4. An owner creates the **invoice** (subtotal / GST / total).
5. The browser builds the **PDF with jsPDF**; `send-invoice` files it to the
   private `invoices` bucket and emails it via Resend.
6. Record a **payment**; the invoice `status` updates automatically.

### Money posts itself (double-entry)
Every invoice, payment, credit note and expense **auto-posts to the ledger** via
database triggers — nobody writes journal entries by hand. See §8.

### Purchasing
Staff raise a **part request** → an owner turns it into a **purchase order**
(`create_po_from_request()`) → when goods arrive, **receive** the PO
(`receive_purchase_order()`, supports partial receipts) which increases stock.
A PO line can also be pushed straight onto a job (`accept_po_item_to_job()`).

### Service reminders
`/due` lists machines roughly a year since last service. Staff send a reminder
email (`send-reminder`); `send-statements` runs on a schedule to email customers
what they owe. `sms_messages` + `due_for_sms_reminder()` back the SMS reminders.

---

## 8. The accounting engine

A real **double-entry ledger**, added in `0003_accounting_core.sql`.

**Chart of accounts** (seeded): `100 Bank`, `110 Accounts Receivable`,
`120 Parts Inventory`, `200 GST`, `210 Accounts Payable`, `300 Owner Funds`,
`310 Retained Earnings`, `400 Sales — Labour`, `410 Sales — Parts`,
`420 Sales — Other`, `500 Cost of Parts`, `510 Wages`, `520 Rent`,
`530 Utilities & Overheads`, `540 Other Expenses`.

**Posting rule.** All entries go through `post_entry(...)`, which **refuses to
save unless debits equal credits** (and rounds to cents). `journal_lines` also
enforce that each line is one-sided and non-zero. So the books can never go out
of balance.

**Auto-posting triggers** (you just create the business record; the ledger
follows):

| When you insert… | The ledger records |
|---|---|
| an **invoice** | Dr Accounts Receivable (total); Cr Sales-Labour/Parts/Other (split by the job's line-item mix); Cr GST |
| a **payment** | Dr Bank; Cr Accounts Receivable |
| a **credit note** | the reverse of an invoice (Cr AR; Dr income + GST) |
| an **expense** | posted to the relevant expense account |
| a **supplier payment** | posted against Accounts Payable / Bank |

`sync_invoice_status()` recomputes an invoice's status (`Unpaid` / `Part-paid` /
`Paid`) and `paid_date` whenever payments change.

**Reporting functions** (owner-gated): `accounting_overview()` (account balances,
monthly income, recent entries → `/accounting`), `outstanding_statements()`
(who owes what), and `balance_sheet()` / the financial report (→ `/reports`).

---

## 9. Edge Functions & email

TypeScript functions in `supabase/functions/`, called from the app (or a schedule).
They re-check permissions server-side and read the **editable email templates**
from `shop_settings`, so the shop can reword messages without code changes.

| Function | Who can call it | Does |
|---|---|---|
| `send-invoice` | owner with can-send | files the invoice PDF (private bucket) + emails it |
| `send-purchase-order` | approved staff | emails the PO PDF to the supplier |
| `send-reminder` | approved staff | emails a service reminder |
| `send-statements` | scheduled (CRON secret + service role) | builds each customer's statement PDF (pdf-lib) and emails it |

Email goes out through **Resend**. Secrets (`RESEND_API_KEY`, service role key,
`CRON_SECRET`) live in Supabase/Vercel settings — never in the repo.

---

## 10. Storage buckets

| Bucket | Public? | Holds |
|---|---|---|
| `invoices` | private | invoice/credit-note PDFs (accessed via short-lived signed URLs; `invoices.pdf_url` stores the **path**, not a public URL) |
| `job-photos` | public | photos attached to jobs |
| `listing-photos` | public | used-ATV listing photos |

---

## 11. Conventions & gotchas

- **Client-first pages.** Most pages start with `"use client"` and query Supabase
  directly. There's no REST API layer to add endpoints to — you add a table +
  RLS policy, then query it from the page.
- **RLS is the security boundary.** When you add a table, **enable RLS and add a
  policy**, or it's either wide open or fully blocked. Copy the `staff_all`
  pattern from `0001`.
- **Multi-step logic → a Postgres function.** Anything touching several tables
  (receiving stock, counter sales, posting money) is a `SECURITY DEFINER`
  function so it runs atomically and can't be half-done from the browser.
- **Numbering** (job, invoice, credit-note numbers) is auto-assigned by Postgres
  identity columns; expenses start at 10000; numbers display as 4–5 digits.
- **Dates use NZ time** (`Pacific/Auckland`) at the database level.
- **Money is `numeric` with `round(x, 2)` checks** throughout — no floats.
- **Migrations are the version-controlled record**, but **Supabase is the source
  of truth** (`supabase/README.md`). Add a new **sequentially numbered** migration
  for every schema change; keep them idempotent (`if not exists` / `or replace` /
  `drop … if exists`) so re-running is safe.
- **One Supabase client** (`lib/supabaseClient.js`) is shared everywhere.

---

## 12. How to extend it (quick recipes)

- **New back-office screen:** add `app/<name>/page.js` (`"use client"`), query
  Supabase; if it's money/admin, add its path to `OWNER_ONLY` in `AuthGate.js`
  and a link in `NavBar.js`.
- **New table:** write a numbered migration — `create table`, `enable row level
  security`, and a policy (usually `for all to authenticated using
  (is_approved_staff())`). Apply it, then query from a page.
- **New checklist:** add a row to `checklist_templates` (via `/templates` or a
  seed migration like `0025_seed_service_checklists.sql`).
- **New email:** add an Edge Function that checks permissions, reads its template
  from `shop_settings`, and sends via Resend.

---

*Living document — update it when the shape of the app changes.*
