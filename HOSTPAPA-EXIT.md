# Getting off HostPapa — cutover runbook

Drafted 3 Nov 2026. Companion to `FASTMAIL-PLAN.md`, which covers the mail
migration this finishes.

---

## The one thing that can go badly wrong

**Both domains' DNS is served by HostPapa's nameservers.**

    betterservice.co.nz   NS → ns1.hostpapa.com, ns2.hostpapa.com
    flipbikes.co.nz       NS → ns1.hostpapa.com, ns2.hostpapa.com
    SOA on both           ns1.hostpapa.com. admin.hostpapa.ca.

Cancel the HostPapa account before moving DNS and ns1/ns2 stop answering for
these zones. At that moment **both websites and all mail for both domains
stop**. Not degraded — gone, and gone for everyone, including customers
mid-order. There is no partial failure to notice early.

So the order is forced and not negotiable:

    move DNS  →  verify  →  wait  →  cancel

Everything else in this file is detail hanging off that sentence.

---

## UNRESOLVED — answer this before starting

**Who are the domains registered with?** Not established.

DNS hosting and domain registration are different things and HostPapa sells
both. If the `.co.nz` registrations sit with HostPapa, cancelling may put the
domains themselves at risk, and a lapsed `.co.nz` can be taken by anyone. That
is the one mistake on this page with no undo.

Attempts made 3 Nov: the registry's port 43 whois is unreachable from the
agent's network; `.nz` publishes no RDAP; the DNC web lookup is behind a
CAPTCHA, which is not something to work around; HostPapa's own dashboard
returned an error page.

Two ways to get it:

1. `dnc.org.nz/whois` — enter the domain, pass the CAPTCHA, read the registrar.
2. The HostPapa account, under Domains.

**If the domains are registered elsewhere** (likely — they predate the current
setup) this is a clean DNS move and the runbook below is the whole job.

**If they are registered at HostPapa**, a registrar transfer comes first. That
is a days-long process needing UDAI codes per domain, and the hosting account
must stay open until it completes. Do not cancel anything until both domains
show the new registrar.

---

## Where each domain actually stands

Measured 3 Nov 2026 against public DNS, not read off a dashboard.

### betterservice.co.nz

| What | Value | Verdict |
|---|---|---|
| apex A | `216.150.1.1` | Vercel — already off HostPapa |
| www | CNAME → apex, served by Vercel | fine |
| MX 10 / 20 | `us1/us2-smtp.messagingengine.com` | Fastmail |
| **MX 30** | `mx.betterservice.co.nz.cust.a.hostedemail.com` | **HostPapa — remove** |
| SPF | includes `_spf.hostedemail.com`, `ip4:66.102.132.100`, `+ip4:65.39.193.20` | HostPapa terms — remove at the end |
| SPF | also includes `_spf.mlsend.com` | **MailerLite — keep** |
| TXT | `mailerlite-domain-verification=…` | **keep** |
| DKIM | `fm1/fm2/fm3._domainkey` → fmhosted | Fastmail — keep |
| DKIM | `default._domainkey` (live RSA key) | HostPapa leftover — remove |
| `_dmarc` | `v=DMARC1; p=none;` | keep, see note below |
| `mail.` | → `…cust.a.hostedemail.com` (216.40.42.5) | HostPapa webmail — remove |
| `ftp.` `cpanel.` `webmail.` | `66.102.132.100` | HostPapa — remove |
| CAA (×8) | letsencrypt, pki.goog, sectigo, globalsign | **keep — see the CAA trap** |

**Fastmail currently lists this domain as INACTIVE** — "MX records not pointing
to Fastmail" — purely because of the MX 30 entry. DKIM and SPF both pass. Mail
is flowing anyway; the MX 30 host simply never gets used while 10 and 20
answer. Removing MX 30 flips the domain to Active and costs nothing.

### flipbikes.co.nz

| What | Value | Verdict |
|---|---|---|
| **apex A** | `66.102.132.28` — HostPapa shared box (`sh-cp2-au.yyz2.servername.online`) | **HostPapa, and load-bearing** |
| www | CNAME → `58430e31f7244462.vercel-dns-016.com` | Vercel |
| MX 10 / 20 | Fastmail only — no HostPapa MX | already clean |
| SPF | `v=spf1 include:spf.messagingengine.com include:_spf.hostedemail.com ~all` | drop the hostedemail term |
| DKIM | fm1/fm2/fm3 → fmhosted | keep |
| DKIM | `default._domainkey` | HostPapa leftover — remove |
| `_dmarc` | **absent** | add one while you are in here |
| `mail.` `ftp.` `cpanel.` `webmail.` | HostPapa | remove |
| CAA (×8) | as above | keep |

**The apex is the live dependency.** `https://flipbikes.co.nz/` returns a `301`
to `https://www.flipbikes.co.nz/` and that redirect is being performed by
HostPapa's nginx. It is also the cause of Vercel's "1 domain needs
configuration" email. Repointing the apex at Vercel fixes the nag and removes
the dependency in one move.

Fastmail lists flipbikes.co.nz as **Active**.

---

## Two traps worth naming

**You cannot rebuild a zone by guessing record names.** The table above was
assembled by querying names I thought to ask for — `www`, `mail`, `ftp`,
`cpanel`, `webmail`, `_dmarc`, `fm1-3._domainkey`, and so on. DNS has no "list
everything" query from outside. Anything named something I did not think of —
an old `shop.`, a verification TXT for a service nobody remembers, a staging
host — is invisible here and will simply stop existing after the move.

**So export the zone file from cPanel first** (Zone Editor has a download) and
treat that as the source of truth. Use the table above only to check the export
against, and to decide what each record is for. If the two disagree, the export
is right and I was wrong.

**The CAA trap.** Those eight CAA records decide which certificate authorities
may issue for the domain. Vercel issues through Let's Encrypt. Drop the CAA
records in the move and nothing breaks today — certificates already issued keep
working — but **renewal silently fails weeks later**, and the first symptom is
a browser security warning on a live shop. Carry them across exactly.

---

## The cutover

Do one domain at a time, start with **flipbikes.co.nz** — it has less attached
to it and a smaller blast radius than the domain carrying the workshop's mail.

### Step 0 — before touching anything

- [ ] Registrar established (see above). Stop here if it is HostPapa.
- [ ] Zone file for both domains exported from cPanel Zone Editor and **saved
      somewhere outside HostPapa**. This is the undo button for the whole
      exercise.
- [ ] Note today's SOA serials: betterservice `2026101503`, flipbikes
      `2026100603`. If one changes under you mid-move, someone else edited the
      zone.

### Step 1 — TTLs: measured 3 Nov, mostly already fine

Actual TTLs as served by HostPapa's nameservers:

| Record | betterservice | flipbikes |
|---|---|---|
| `NS` | **86400s (24h)** | **86400s (24h)** |
| apex `A` | 14400s (4h) | 300s |
| `www` | 14400s (4h) | 300s |
| `MX` / `TXT` | 300s | 300s |
| `CAA` | 60s | 60s |
| `_dmarc` | 14400s (4h) | — |

Mail records are already at 5 minutes on both domains, which is the part that
would hurt. The only records worth dropping to 300s first are betterservice's
apex `A`, `www` and `_dmarc` — and betterservice's apex is not changing anyway,
so even that is close to a formality.

**The 24-hour NS TTL is the real clock, and lowering record TTLs does nothing
about it.** After the delegation changes, resolvers that cached the old NS can
keep asking HostPapa for up to a day.

Which leads to the rule that matters more than any of the above:

> **HostPapa's nameservers must keep serving the correct zone throughout.**
> Do not delete the zone, empty it, or cancel the account on the day of the
> switch. For up to 24 hours, some of the internet is still asking them, and
> the answer they give has to be the right one.

### Step 2 — build the zone at Fastmail, with NS still at HostPapa

Fastmail → Settings → Domains → the domain → **Customize DNS**. Enter every
record from the export. Nothing is live yet; the NS still point at HostPapa, so
this is a safe dry build you can take your time over.

Record-by-record for **flipbikes.co.nz**:

| Type | Name | Value | Note |
|---|---|---|---|
| A | `@` | **Vercel apex IP** | take it from Vercel → flipbikes-site → Settings → Domains. Do not copy the betterservice value blind; confirm it. |
| CNAME | `www` | `58430e31f7244462.vercel-dns-016.com` | exactly as it is today |
| MX | `@` | Fastmail's own, 10 and 20 | Fastmail fills these |
| TXT | `@` | `v=spf1 include:spf.messagingengine.com ~all` | hostedemail term dropped |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:…` | new — currently absent |
| CNAME | `fm1/fm2/fm3._domainkey` | fmhosted targets | Fastmail fills these |
| CAA | `@` | all eight, unchanged | see the CAA trap |

Not carried over: `mail.`, `ftp.`, `cpanel.`, `webmail.`, `default._domainkey`.

For **betterservice.co.nz**, same shape, plus:

| Type | Name | Value | Note |
|---|---|---|---|
| A | `@` | `216.150.1.1` | unchanged — already Vercel |
| CNAME | `www` | `betterservice.co.nz` | unchanged |
| TXT | `@` | `v=spf1 include:spf.messagingengine.com include:_spf.mlsend.com ~all` | **MailerLite term kept**, HostPapa terms and both `ip4:` dropped |
| TXT | `@` | `mailerlite-domain-verification=394da…` | keep verbatim or MailerLite breaks |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | as today; consider adding `rua=` |

Not carried over: MX 30, `mail.`, `ftp.`, `cpanel.`, `webmail.`,
`default._domainkey`.

### Step 3 — switch the NS

At the **registrar** (not HostPapa, unless they turn out to be the same),
change the nameservers to Fastmail's. Then wait — `.nz` delegation changes are
usually minutes but can take a few hours.

### Step 4 — verify, and verify the right things

Do not accept a dashboard's word for any of this. Check it from outside:

- [ ] `NS` for the domain returns Fastmail, from more than one resolver
      (1.1.1.1 and 8.8.8.8 at minimum)
- [ ] `https://flipbikes.co.nz/` still `301`s to www — **and the `server:`
      header now says Vercel, not nginx.** A working redirect is not proof the
      apex moved; HostPapa's redirect worked too.
- [ ] `https://www.flipbikes.co.nz/` returns `200`
- [ ] `https://betterservice.co.nz/` returns `200`
- [ ] MX returns only the two Fastmail hosts
- [ ] Fastmail → Domains shows **both** domains Active, betterservice included
- [ ] **Send a real email in and out of each domain.** Not a test to yourself —
      a real message to an outside address and a reply back. `emailed = true`
      has never meant delivered on this project and a green tick in a panel
      means even less.
- [ ] Place a test order on flipbikes.co.nz and confirm the order email arrives
- [ ] MailerLite still shows the domain verified

### Step 5 — let it sit

**Minimum: 48 hours after step 4 passes**, because of the 24-hour NS TTL.
Cancelling inside that window can cut off the resolvers still pointed at
HostPapa, and the failure is invisible from here — everything looks right from
a machine whose cache has already moved on.

Beyond 48 hours it is a judgement call, and the honest framing is this:

> **The saved zone export is the insurance, not the calendar.** A soak period
> only helps if someone would notice. What actually protects you is being able
> to read, after cancelling, exactly what the zone used to contain. With that
> file saved, a record discovered missing in February is a five-minute fix.
> Without it, no amount of waiting helps, because the thing you would need to
> look at is gone.

So if a renewal date is forcing the issue: make sure the export is saved and
readable, confirm step 4 end to end, wait the 48 hours, and cancel. Do not pay
another cycle for a soak you are not going to actively watch — but do not skip
the export to save a day, either.

**One thing a billing date cannot override:** if the domains turn out to be
registered at HostPapa, a *domain* renewal is not the same as a *hosting*
renewal and must be paid regardless, until the transfer completes. Letting a
`.co.nz` lapse to save a month's hosting is not a trade worth making.

During the wait, the catch-all can be left exactly as it is. It is already
redundant — `admin@`, `accounts@`, `sales@flipbikes.co.nz` and `service@` are
all aliases on Craig's Fastmail account, confirmed 3 Nov — but redundant is
not the same as harmful, and it is a free safety net while the dust settles.

### Step 6 — cancel, then tidy

- [ ] Cancel the HostPapa account
- [ ] Only now, raise the TTLs back to something sane (3600)
- [ ] Nothing left to strip from SPF — the hostedemail and `ip4:` terms went in
      step 2

---

## What this does not cover

- **Email history on HostPapa.** `FASTMAIL-PLAN.md` records that the only real
  mailboxes were `accounts@` and `service@` and both reported 0 bytes, so there
  should be nothing to rescue. Worth one look in webmail before cancelling
  rather than taking a five-week-old note's word for it.
- **Files on the shared hosting.** The flipbikes apex box is serving a redirect
  from somewhere. Check whether anything else lives in that account — old site
  files, a forgotten script — before it is deleted.
- **Anything billed through HostPapa other than hosting.** SSL add-ons, backups,
  a second domain nobody remembers.
