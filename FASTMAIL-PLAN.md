# Moving Craig's mail to Fastmail

Written 3 Oct 2026. Both domains are added to Fastmail; **no DNS has been changed
for mail yet.** Mail still flows to HostPapa and will until we switch the MX.

## Account

- Fastmail **Business Standard**, NZ$8.50/user/month, bought 1 month first
  (NZ$10.20) to avoid committing during the migration. Switch to annual once
  Craig's mail is proven.
- Owned and administered by **Ben** (Northline Systems), recharged to Craig.
  Craig's risk is covered by him owning the **domains** — whoever holds the
  domain can repoint MX in five minutes, so the mailbox host is not a lock-in.
- Data residency: **US** (only US and EU offered; no AU/NZ option).
- Seats: Ben (admin) + Craig = **2**. `sales@flipbikes.co.nz` is an **alias**
  into Craig's mailbox, not its own seat — Ben's decision, 3 Oct.
- Admin addresses taken by Ben: `admin@flipbikes.co.nz`,
  `postmaster@betterservice.co.nz`.
  **NOT `admin@betterservice.co.nz`** — that is the From address on Craig's
  invoices, so replies to invoices land there and must reach Craig, not Ben.

## The records Fastmail wants

Same for both domains except the hostname inside the DKIM targets.

**MX** (this is the switch — nothing moves until this changes)

    priority 10   us1-smtp.messagingengine.com
    priority 20   us2-smtp.messagingengine.com

**DKIM** — three CNAMEs. **Safe to add at any time**; publishing a key changes
no delivery.

    fm1._domainkey  ->  fm1.<domain>.dkim.fmhosted.com
    fm2._domainkey  ->  fm2.<domain>.dkim.fmhosted.com
    fm3._domainkey  ->  fm3.<domain>.dkim.fmhosted.com

**SPF** — Fastmail's generic instruction is:

    v=spf1 include:spf.messagingengine.com ?all

## DO NOT paste that SPF in. It will break things.

Fastmail's instruction assumes the domain sends through Fastmail and nothing
else. Both of Craig's domains send through other systems too, and that line
**replaces** the existing record.

**betterservice.co.nz today:**

    v=spf1 include:_spf.mlsend.com ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all

`_spf.mlsend.com` is **MailerLite** — Craig's newsletters. Paste Fastmail's line
over this and his marketing mail starts failing SPF, silently, with no error
anywhere. There is also a `litesrv._domainkey` **CNAME** for MailerLite DKIM in
that zone which must be left exactly as it is — it is a CNAME, not a TXT, and
rebuilding it as a TXT breaks it quietly.

**Transitional SPF, to use at MX-switch time, not before** — keeps both senders
valid while HostPapa is still alive:

    betterservice.co.nz
    v=spf1 include:spf.messagingengine.com include:_spf.mlsend.com ip4:66.102.132.100 ip4:65.39.193.20 include:_spf.hostedemail.com ~all

    flipbikes.co.nz
    v=spf1 include:spf.messagingengine.com include:_spf.hostedemail.com ~all

Keep `~all` (softfail), not Fastmail's `?all` (neutral) — `?all` tells receivers
to ignore SPF entirely, which is weaker than what Craig has now.

Once HostPapa is cancelled, drop `include:_spf.hostedemail.com` and the two ip4
terms from betterservice. Watch the 10-lookup SPF limit as includes accumulate.

Resend is unaffected: it sends via its own `send.` / `rsend.` CNAME subdomains,
so the apex SPF does not need a Resend include. Verify rather than assume before
cancelling anything.

## Order of work

1. **Drop MX and SPF TTLs 14400 -> 300** on both zones. No behaviour change.
   Must be done ~4 h before the switch, because the old 4 h TTL has to expire
   first. **This is the only thing with a clock on it.**
2. Add the three DKIM CNAMEs to both zones. Safe any time.
3. Create Craig's user `craig@betterservice.co.nz` in Fastmail; add
   `sales@flipbikes.co.nz` as an alias to it.
4. **IMAP import from HostPapa while those mailboxes are still alive.** Needs
   Craig's two mailbox passwords — blocked until at least Monday 5 Oct. Once
   HostPapa is cancelled, whatever is in there is gone.
5. Switch MX and rewrite SPF together, per the transitional records above.
6. Repoint Craig's iPad.
7. Watch mail arrive for several days.
8. Only then cancel HostPapa. 31 Oct is a billing date, not a technical one —
   the paid-up period is free overlap, so use it.

## Open

- Craig does not necessarily know his mailbox passwords; Apple Mail may have
  saved them years ago. If so they get reset from cPanel Email Accounts first,
  which breaks his iPad until it is repointed — that changes the order above.
- Decide where `admin@betterservice.co.nz` should deliver after the move, since
  invoice replies go there.
