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

1. ~~**Drop MX and SPF TTLs 14400 -> 300** on both zones.~~ **DONE 5 Oct.**
   No behaviour change. Had to be done ~4 h before the switch, because the old
   4 h TTL has to expire first. **This was the only thing with a clock on it.**
2. ~~Add the three DKIM CNAMEs to both zones.~~ **DONE 5 Oct.** Safe any time.
3. Create Craig's user `craig@betterservice.co.nz` in Fastmail, with `admin@`,
   `accounts@` and `service@` as aliases into it, plus `sales@flipbikes.co.nz`.
   Set one mailbox-level forward to Craig's Gmail for the transition.
4. ~~**IMAP import from HostPapa.**~~ **DOES NOT EXIST — confirmed 5 Oct.**
   There is no mail on HostPapa to move; see below. Craig's mailbox passwords
   are not needed after all.
5. Switch MX and rewrite SPF together, per the transitional records above.
6. ~~Repoint Craig's iPad.~~ **DOES NOT EXIST — confirmed 5 Oct.** The iPad is
   configured against Gmail, not HostPapa. Nothing on it to repoint.
7. Watch mail arrive for several days.
8. Only then cancel HostPapa. 31 Oct is a billing date, not a technical one —
   the paid-up period is free overlap, so use it.

## What betterservice's mail actually does today — read this first

Found 5 Oct by reading cPanel, and it is not what the setup implies.

**There are only two real mailboxes, `accounts@` and `service@`, and both
report 0 bytes.** Craig does not read either of them.

**`admin@betterservice.co.nz` is not a mailbox at all.** It does not exist. The
domain's **Default Address (catch-all)** is set to forward every unrouted
message to Craig's personal Gmail, `cmbarrett7@gmail.com` — so replies to
invoices, which are addressed to `admin@`, fall through the catch-all and land
in his Gmail. The same is true of anything else a customer guesses at: `info@`,
`sales@`, `craig@`.

**This is the trap in the migration.** Move the MX to Fastmail without
recreating that behaviour and every reply to an invoice stops arriving, with no
bounce and no error anywhere. Nothing would look broken.

It also means the IMAP import (step 4) may have almost nothing to carry —
Craig's mail history is in Gmail, not on HostPapa. Confirm before spending time
on it.

## Progress — 5 Oct 2026

Done at Craig's desk, both cPanel accounts (betterservice = `bette671` on
sh-cp4-au; flipbikes on sh-cp2-au — the account chooser at
hostpapa.co.nz/dashboard/my-cpanel lets both be open at once).

**Step 1 — TTLs dropped to 300.** Verified against `ns1`/`ns2.hostpapa.com`:

    betterservice.co.nz  MX   300   (was 14400)
    betterservice.co.nz  TXT  300   (both apex TXT records)
    flipbikes.co.nz      TXT  300
    flipbikes.co.nz      MX   stored 300, still *published* as 14400

Two things worth remembering:

- **cPanel refuses a TTL that differs within an RRset.** betterservice has two
  apex TXT records (the SPF and a `mailerlite-domain-verification=` string).
  Saving one at 300 fails with *"records have mismatched TTL values"*. The fix
  is to open **both** rows for edit, set both to 300, and use **Save All
  Records** — saving them one at a time can never succeed.
- **flipbikes MX publishes 14400 even though cPanel stores 300.** Re-saved
  twice; the A and TXT records on the same zone updated instantly, the MX did
  not. Most likely the old RRset is still cached at HostPapa's public
  nameservers and will age out within 4 h. It does not block anything — we were
  always going to wait before the switch — but **re-check it with `dig` before
  touching the MX**, and assume up to a 4 h tail on flipbikes rather than 5 min.

**Step 2 — DKIM CNAMEs added to both zones**, TTL 14400 (fine; they never
change). All six resolve through to Fastmail:

    fm1/2/3._domainkey.<domain>  ->  fm1/2/3.<domain>.dkim.fmhosted.com
    -> "v=DKIM1; k=rsa; n=Intentionally_Left_Blank_As_Per_DKIM_Rotation_BCP; p="

The blank `p=` is correct and expected — Fastmail publishes placeholder keys and
fills them in once the domain actually sends through them. Nothing to fix.

Existing `default._domainkey` (HostPapa) and `resend._domainkey` were not
touched. MX on both domains still points at HostPapa. **No mail has moved.**

Next: step 3 (Craig's Fastmail user + `sales@` alias) and step 4 (IMAP import),
both of which need Craig's mailbox passwords.

## Decisions — 5 Oct 2026 (Ben, with Craig present)

**Craig reads invoice replies in his Gmail**, confirmed. **He wants a real
`admin@betterservice.co.nz` mailbox.**

**`admin@` → alias into Craig's Fastmail mailbox, AND a copy forwarded to his
Gmail.** Belt and braces during the transition: nothing can be missed while he
is still in the Gmail habit, and he can reply properly as `admin@` when he
chooses to. Switch the Gmail forward off once he has settled — that is a
deliberate later step, not something to forget. No extra seat; an alias, not a
user.

**Catch-all → dropped; unknown addresses rejected.** Once `admin@` is real, a
catch-all mostly collects spam, and today Google is the only reason that spam
is invisible — pointing a catch-all at a fresh Fastmail mailbox would dump it
all in front of Craig. Rejecting also means a human typo bounces back visibly
to the sender instead of disappearing.

**Ben's call, 5 Oct: drop the catch-all, create only the addresses that are
really used.** The list below is that list. It is not guesswork — it comes from
reading both codebases, so every entry has a traceable reason to exist.

### The addresses that must receive

**betterservice.co.nz**

| Address | Why it must exist |
|---|---|
| `admin@` | From address on most app email (rent, reminders, statements, POs, pick-up dispatch) **and** the BCC on every invoice — `shop_settings.invoice_bcc`, set by migration 0040. Craig's own copy of every invoice lands here. |
| `accounts@` | From address on **workshop invoices**. A customer hitting reply on an invoice replies to *this*, not to `admin@`. |
| `craig@` | The **Flip Bikes website contact form sends every enquiry here** (`api/send.js`, `const TO`). Also published as the business email in the homepage schema.org block, so Google surfaces it. |
| `service@` | Existing HostPapa mailbox, 0 bytes, not referenced anywhere in code. **Ask Craig before retiring it.** |
| `postmaster@` | Ben's admin address, already claimed in Fastmail. |

**flipbikes.co.nz**

| Address | Why it must exist |
|---|---|
| `noreply@` | Resend's From on the contact form. Send-only — it never needs to receive, but it must not hard-bounce. |
| `sales@` | Alias into Craig, per the seat decision above. |
| `admin@` | Ben's admin address. |

`you@betterservice.co.nz` and `name@betterservice.co.nz` appear in the code but
are **placeholder text** in the login and staff forms. Not real addresses.

### The one that would have bitten us

`craig@betterservice.co.nz` has never been a mailbox either. It works today
*only* because the catch-all forwards it to Craig's Gmail. Drop the catch-all
without creating `craig@` and **every enquiry from the Flip Bikes website stops
arriving** — the same form we fixed and tested on 3 Oct. Nothing would appear
broken at either end.

## Still open

- Craig does not necessarily know his mailbox passwords; Apple Mail may have
  saved them years ago. If so they get reset from cPanel Email Accounts first,
  which breaks his iPad until it is repointed — that changes the order above.
  (Ben had the passwords in hand on 5 Oct.)
- flipbikes.co.nz has not been checked for the same catch-all pattern. Assume
  it has one until proven otherwise.

## What flipbikes.co.nz's mail does today — nothing

Read from cPanel, 5 Oct:

- **No mailboxes at all.** The only account is the system account `flipb816`
  (104 KB of cron noise).
- **No forwarders**, individual or domain-wide.
- Default Address is **`:fail: No Such User Here`** — unrouted mail is rejected.

So **flipbikes.co.nz receives no mail whatsoever.** Every address on the domain
bounces, `sales@` included. Nothing is published on the site pointing at it —
the contact form sends *to* `craig@betterservice.co.nz` — so nobody has been
losing mail, it simply has never been a mail domain.

That makes flipbikes the easy half: nothing to import, nothing to preserve,
nothing that can break. Pointing its MX at Fastmail is purely additive — it
starts receiving mail it currently refuses.

`noreply@flipbikes.co.nz` hard-bounces today if anyone replies to it. Harmless
in practice, because `api/send.js` sets `reply_to` to the customer's own
address, but worth knowing.

## Step 4 (IMAP import) is almost certainly unnecessary

Both betterservice mailboxes report 0 bytes; flipbikes has no mailboxes at all.
There is nothing on HostPapa to carry across. That removes the dependency on
Craig's mailbox passwords, and with it the risk in the "Open" note below about
resetting them and breaking his iPad.

**One thing to confirm before believing it**: what mail account is actually
configured on Craig's iPad? Two possibilities with very different consequences.

- If the iPad is set up against **Gmail**, everything is consistent — the
  catch-all feeds Gmail, Craig reads Gmail, HostPapa's mailboxes are genuinely
  unused and empty, and step 6 (repoint the iPad) is a no-op too.
- If the iPad is set up against **HostPapa over POP3**, the mailboxes are empty
  *because the iPad has been downloading and deleting the mail for years.* The
  only copy of that history would then be on the device, HostPapa's cancellation
  breaks the account, and losing the iPad loses the mail. That needs handling
  before anything is cancelled.

Ask Craig to open Settings -> Mail -> Accounts on the iPad and say what is
listed. It is a thirty-second check that decides whether steps 4 and 6 exist.

- 5 Oct: Craig confirmed `service@` is **not used**, but wants it kept anyway.
  Carry it as an alias into his mailbox.

## Settled, 5 Oct — the plan is three steps, not eight

Craig confirmed **the iPad is on Gmail.** That closes the only open question.

Everything is consistent: HostPapa's catch-all forwards to Craig's Gmail, Craig
reads Gmail, the two betterservice mailboxes are genuinely unused and empty, and
the iPad never touched HostPapa. Nothing has been silently draining those
mailboxes; there was never anything in them.

**Steps 4 and 6 are deleted.** No IMAP import, no iPad to repoint, and Craig's
mailbox passwords are not needed. What is left:

1. ~~TTLs~~ done
2. ~~DKIM~~ done
3. **Build the addresses in Fastmail** — Ben's job, does not need Craig
4. **Switch MX + SPF together** — the one moment anything can go wrong
5. **Watch for several days**
6. **Cancel HostPapa last**

### One thing deliberately left alone

Craig replies to customers from Gmail, so his replies go out as his personal
address rather than the business. That is how it works today and the move does
not change it either way. It could be improved later by setting Gmail's "send
mail as" to `admin@betterservice.co.nz` over Fastmail's SMTP. **Not part of this
migration** — noted so it is not rediscovered as a bug.
