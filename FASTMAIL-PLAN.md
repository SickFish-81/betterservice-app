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

## Step 3 built, 5 Oct

Fastmail independently confirms the DKIM work: betterservice.co.nz now reads
**"DKIM is correctly configured."** MX reads "not pointing to Fastmail" and SPF
"not configured" — both correct, both are the cutover.

Fastmail's own instructions confirm the MX values in this plan:

    priority 10   us1-smtp.messagingengine.com
    priority 20   us2-smtp.messagingengine.com

and it does serve up the destructive generic SPF line,
`v=spf1 include:spf.messagingengine.com ?all`, exactly as warned above. Do not
use it.

**Users**

    Ben    northlinesystems@fastmail.com   Standard, Admin
    Craig  craig@betterservice.co.nz       Standard, NZ$10.20/month

Craig's seat was purchased 5 Oct — NZ$9.35 pro-rata now, NZ$10.20/month after.

**Aliases**

    admin@betterservice.co.nz      -> craig    App email From + BCC on every invoice
    accounts@betterservice.co.nz   -> craig    From on workshop invoices; customers reply here
    service@betterservice.co.nz    -> craig    Legacy, unused, kept at Craig's request
    sales@flipbikes.co.nz          -> craig    Flip Bikes sales enquiries
    admin@flipbikes.co.nz          -> ben
    postmaster@betterservice.co.nz -> ben

Every address from the evidenced list is now built, and `craig@` is the user
itself rather than an alias, so the Flip Bikes contact form keeps working.

### Step 3 is complete

`noreply@flipbikes.co.nz` was added as an alias to Ben, so it accepts rather
than bounces once flipbikes' MX moves. It is send-only — `api/send.js` sets
`reply_to` to the customer — but a From address that refuses mail can cost
deliverability with receivers that probe the sender, and the alias is free.

**The transitional Gmail copy is live.** Fastmail exposes no admin-side
forwarding control, so it is a rule inside Craig's own account, created by
admin masquerade:

    Rule: "Transitional: copy everything to Craig's Gmail (turn off once settled)"
    If   all messages
    Then send a copy to cmbarrett7@gmail.com
         continue to apply other rules

Nothing is moved or deleted, so the original stays in Craig's Fastmail Inbox and
he keeps reading in Gmail exactly as he does now. **The rule's name is the
reminder** — it says what to do with itself.

Fastmail runs spam filtering *before* rules, so spam goes to his Spam folder and
is never copied onward. The copy carries real mail only.

Saving a rule requires a password confirmation, so that step is Ben's — Claude
does not type passwords.

## CUTOVER DONE — betterservice.co.nz, 6 Oct 2026

Mail is flowing through Fastmail. Proven by real traffic, not a test message.

**What was changed**

    SPF   v=spf1 include:spf.messagingengine.com include:_spf.mlsend.com
          ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all
    MX    10  us1-smtp.messagingengine.com          (added)
    MX    20  us2-smtp.messagingengine.com          (added)
    MX    30  mx...cust.a.hostedemail.com           (was priority 0)

**The HostPapa MX was demoted, not deleted.** Changing its priority from 0 to 30
makes Fastmail primary while keeping the old record intact: the rollback is one
number, not a retyped hostname, and if Fastmail is ever briefly unreachable mail
still falls through to HostPapa while that account is alive. Do it this way
round on flipbikes too.

Verified at ns1, ns2, 1.1.1.1 and 8.8.8.8 before anything was deleted or sent.

**SPF lookup budget**: all three includes resolve to flat ip4 lists with nothing
nested, so the record costs 3 of the permitted 10. Room to add another sender
later without restructuring.

### Fastmail's own status panel is wrong — ignore it

After the cutover, with mail demonstrably arriving, Fastmail still reports:

    MX   "MX records not pointing to Fastmail.
          Messages sent to this domain will not come to Fastmail."
    SPF  "SPF is not configured!"

Both are false — mail was demonstrably arriving. **The explanation was tested on
6 Oct once flipbikes went live, and it is half right. See the correction below
before relying on it.**

**Do not act on that panel.** Judge by delivered mail. Noted here so nobody
"fixes" a working setup by pasting Fastmail's generic records over the top —
which is exactly the trap this document opens by warning about.

### Evidence of real traffic

Within about ten minutes of the switch, Craig's Fastmail mailbox received:

    12:41  spam, filed to Spam
    12:54  spam, filed to Spam
    13:42  spam, filed to Spam
    13:48  Fwd: GST Queries - September 2026 — real business mail, Inbox

Spam filtering is working on a brand-new mailbox with no sender history, and
**nothing legitimate was misfiled** — the risk worth checking on day one. The
accountant thread landing in the Inbox is the proof that ordinary business mail
gets through.

### Still unverified

**Whether the Gmail copy rule is firing.** That can only be confirmed by Craig
looking in his own Gmail. It matters: if it is not working, mail is accumulating
in a Fastmail inbox he has never opened — including a GST query from his
accountant. Check this before assuming the migration is invisible to him.

### Still to do

- ~~flipbikes.co.nz~~ **DONE 6 Oct** — see below
- Watch for several days
- Turn off the Gmail copy rule once Craig is settled
- Cancel HostPapa last, and only then drop `include:_spf.hostedemail.com` and
  the two ip4 terms from the SPF record

## Gmail copy rule disabled, 6 Oct — and the thing to watch

Craig reported getting **two copies** of his mail in Gmail, and emailed Ben
about it: *"are copies of my emails from @betterservice.co.nz supposed to be
going to cmbarrett..."*. Ben's call: switch the copy off.

Done — **disabled, not deleted**. Fastmail's rule editor has a `Disable → Skip
this rule` tick at the bottom of the edit view. The rule now shows `Disabled`
in the list with its action and destination intact, so restoring it is one tick
rather than rebuilding it.

### Why this needs checking rather than assuming

The logic is sound only if the premise is: if two independent paths put mail in
Craig's Gmail, removing one leaves one. **Nobody has established what the second
path is.** Candidates, none confirmed:

- the HostPapa catch-all to `cmbarrett7@gmail.com`, which is still configured —
  though with HostPapa's MX demoted to priority 30 it should rarely receive
  anything now
- senders who address both `craig@betterservice.co.nz` and his Gmail directly,
  which would duplicate permanently
- a POP/"check mail from other accounts" fetch configured in his Gmail
- Gmail threading showing a sent and received copy of the same conversation

**If the second path does not exist, Craig now sees none of his business mail**,
because that rule was the only thing putting it in front of him — and he will
not notice it stop.

So: **ask Craig within the hour whether new mail is still reaching his Gmail.**
Not next week. If it has stopped, untick `Skip this rule` and it resumes
immediately.

### The real end state

None of this matters once Craig reads Fastmail directly. Adding the account to
his phone takes a couple of minutes and removes the rule, the duplicates and the
dependency on his Gmail in one go. Worth doing before the HostPapa catch-all is
retired, since that is the last fallback path still standing.

## CUTOVER DONE — flipbikes.co.nz, 6 Oct 2026

Verified at ns1, ns2, 1.1.1.1 and 8.8.8.8:

    MX    10  us1-smtp.messagingengine.com
    MX    20  us2-smtp.messagingengine.com
    TXT   v=spf1 include:spf.messagingengine.com include:_spf.hostedemail.com ~all

**The HostPapa MX was DELETED here, not demoted — the opposite of betterservice,
and deliberately so.**

The deciding detail is what the old server does when it receives something.
flipbikes' catch-all is `:fail: No Such User Here`, so HostPapa rejects every
address on that domain. Left in place as a priority-30 fallback it would turn a
temporary Fastmail outage into permanent bounces: mail drops to the fallback,
gets a hard rejection, and bounces to the sender. With no fallback at all the
sending server simply queues and retries Fastmail later, which is what you want.

On betterservice the opposite holds — its catch-all *accepts* and forwards to
Craig's Gmail, so as a fallback it earns its place and was demoted to 30 rather
than deleted.

Same operation, opposite correct answer. Worth remembering: a backup MX is only
worth having if the backup actually accepts mail.

**This cutover could not break anything.** flipbikes has never received mail —
no mailboxes, no forwarders, everything rejected. Pointing its MX at Fastmail is
purely additive: `sales@`, `admin@` and `noreply@` start working for the first
time. It also removes the small deliverability risk on the contact form, whose
From address (`noreply@flipbikes.co.nz`) previously hard-bounced.

**Both domains are now on Fastmail.**

## Correction: what Fastmail's status panel actually objects to

flipbikes going live gave a clean controlled comparison, because the two domains
differ in exactly the ways that matter.

    flipbikes      2 MX (Fastmail only)      ->  "Active. MX records set."
    betterservice  3 MX (+ HostPapa at 30)   ->  "Not yet active."

**The MX half of the theory is confirmed.** Fastmail marks a domain inactive if
*any* MX record it did not specify is present, even a lower-priority fallback
that never receives anything. Nothing is wrong with betterservice; the panel is
counting records, not testing delivery.

**The SPF half of the theory was wrong, and should not be repeated.** I claimed
Fastmail wanted its own SPF string verbatim. flipbikes disproves it — its record

    v=spf1 include:spf.messagingengine.com include:_spf.hostedemail.com ~all

carries an extra include and uses `~all` rather than Fastmail's `?all`, and the
panel reads **"SPF is correctly configured."** So the checker accepts a
non-standard SPF quite happily.

Which leaves betterservice's "SPF is not configured!" genuinely unexplained. The
likeliest reading is that the SPF check is gated behind the domain being active,
so an inactive domain reports SPF failure regardless — but that is a guess, and
it is labelled as one here rather than written up as fact a second time.

Nothing suggests a real fault: the record is valid, costs 3 of 10 lookups,
names Fastmail first, and its near-identical twin passes. **The clean test comes
free** — when HostPapa is cancelled and that third MX is removed, betterservice
should flip to Active. If SPF still reads red at that point, something real is
wrong and it is worth chasing. Until then, judge by delivered mail.

flipbikes' detail page in full: *"Your domain is correctly set up to send and
receive mail!"* — MX, DKIM and SPF all green.
