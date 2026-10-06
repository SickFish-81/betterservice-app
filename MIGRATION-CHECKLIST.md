# Getting Craig off HostPapa — what's left

Rewritten **6 Oct 2026**, after the mail migration completed. The previous
version was badly out of date: it had the whole mailbox section pending, and
two of those steps turned out not to exist at all.

## The dependency that matters

**HostPapa is still the DNS host for both domains.** Every record — including
the MX records now pointing at Fastmail — is served from `ns1.hostpapa.com` and
`ns2.hostpapa.com`.

**Cancelling HostPapa before DNS has moved takes down mail and both websites.**
Not degrades: stops. The old checklist said "cancel HostPapa last" as if that
were the final step; it is not, it is the step *after* three others.

The real order:

    1. domains transferred away        (5-7 business days, not started)
    2. DNS rebuilt somewhere else      (and nameservers switched)
    3. flipbikes apex off HostPapa
    4. THEN cancel HostPapa

## Done

- [x] **Flipbikes site on Vercel.** `www.flipbikes.co.nz` serves from Vercel.
- [x] **Apex redirect.** `flipbikes.co.nz` 301s to `www`, wildcard on, paths
      kept. Added in cPanel → Redirects with **Do Not Redirect www** so it can
      never loop. No DNS change, so no certificate gap. **Note this runs on a
      HostPapa server — see the blocker below.**
- [x] **Flipbikes contact form works.** Domain verified in Resend, sending-only
      key scoped to flipbikes.co.nz held in Vercel. Live test showed Delivered.
- [x] **The 13 recovered lost enquiries** sent to Craig.
- [x] **Both zones recorded** — `DNS-ZONE-betterservice.md` and
      `DNS-ZONE-flipbikes.md`, the rollback references.
- [x] **MAIL MIGRATED TO FASTMAIL, 5–6 Oct.** Both domains. Craig has his own
      mailbox with every address aliased into it; real business mail is arriving
      and correctly filtered. Full detail in `FASTMAIL-PLAN.md`.
- [x] ~~IMAP import from HostPapa~~ **did not exist.** Both mailboxes held 0
      bytes and flipbikes had none. Craig's mail history is in his Gmail.
- [x] ~~Repoint Craig's iPad~~ **did not exist.** The iPad is on Gmail and never
      touched HostPapa.

## Still to finish on mail

- [ ] **Confirm Craig still sees his mail.** The Fastmail→Gmail copy rule was
      disabled on 6 Oct after he reported duplicates, on the assumption a second
      path exists. **Nobody has verified that.** If there is no second path, his
      business mail is landing somewhere he never opens and he will not notice.
      This is the only open item that fails silently.
- [ ] **Put Fastmail on Craig's phone.** Two minutes, and it makes the item
      above permanently moot.

## Blocker 1: transfer the domains — longest lead, not started

**Does NOT need a support ticket** (HostPapa confirmed 29 Sep):

1. HostPapa dashboard → **My Domains** → **Details**
2. **Contacts tab** — the EPP/UDAI code goes to the **admin contact email**,
   nothing else
3. Domain must be **unlocked** (already done for both)
4. **Transfer EPP tab** — between the Lock and DNS Zone Editor tabs
5. **Send Transfer Code**
6. Hand the code to the new registrar; **5–7 business days**

**Check the admin contact email before clicking Send.** If it is one only Craig
reads, change it to one Ben reads first — otherwise the codes arrive somewhere
inconvenient and it is a second round trip. Changing the **admin** contact is
the low-risk one; leave the registrant alone.

Then pick an NZ registrar where **both Ben and Craig can log in** — a single
point of access is the actual problem being escaped. HostPapa charges $51.99/yr
per domain; most NZ registrars are roughly half.

## Blocker 2: move DNS off HostPapa

Decide where it goes — this has not been settled:

- **Vercel DNS** — what `DNS-PLAN.md` assumes. Free, and it issues the apex
  certificate itself, which solves the flipbikes apex problem at the same time.
  Ties DNS to Ben's Vercel account.
- **Fastmail DNS** — free with the account, and it would manage the mail records
  itself. Ties DNS and mail to one vendor.
- **The new registrar's DNS** — usually the dullest and most portable option.

Whichever: build the zone from the recorded files, **copy every mail record
unchanged**, run `dns-check.py` first as a baseline, switch **betterservice
first** (its zone is otherwise unchanged, so anything that breaks is the move
itself), verify, then flipbikes, then re-run `dns-check.py` and compare.

## Blocker 3: flipbikes apex still points at HostPapa

`flipbikes.co.nz` resolves to `66.102.132.28` — the HostPapa box running the 301
redirect. `www.flipbikes.co.nz` is on Vercel and safe; the bare domain is not.
Point the apex at Vercel as part of the DNS move, **not before** — with the new
provider running DNS the certificate issues cleanly with no gap. Then remove the
cPanel redirect, which has done its job.

(This is the mistake from 30 Sep worth not repeating: the apex was once declared
broken and rolled back when Vercel simply had not finished issuing the
certificate. The failing requests were being served `CN=www.flipbikes.co.nz`.)

## Then, and only then

- [ ] Cancel HostPapa. **31 Oct is a billing date, not a technical one** — the
      paid-up period is free overlap, so use it. But the transfer alone takes
      5–7 business days, so starting late means paying for another month.
- [ ] Drop `include:_spf.hostedemail.com` and the two `ip4:` terms from
      betterservice's SPF record
- [ ] betterservice should then flip to **Active** in Fastmail once the
      priority-30 HostPapa MX is gone. If its SPF warning survives that, it is
      real and worth chasing — see the correction in `FASTMAIL-PLAN.md`.

## Security — do this regardless

- [ ] **Craig emailed his HostPapa account password in plain text** (30 Sep,
      "Re: Hostpapa"). It is sitting in Gmail. Change it, and ask Craig not to
      send passwords by email.
- [ ] Rotate `CRON_SECRET` — it went through a chat transcript. Three places.
      (Parked by Ben, 4 Oct.)

## Found along the way, not blocking

- [ ] Two of nine Flipbikes customers could not work out how to buy
- [ ] Every Flipbikes page carries a Google Analytics tag and a Meta Pixel from
      the original Webflow build. Either Craig can see that data, or they are
      liability with no upside.
- [ ] Ask Craig what `cash4bikes.betterservice.co.nz` is for
