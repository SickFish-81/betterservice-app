# Getting Craig off HostPapa — what's left

Rewritten 2 Oct 2026. Supersedes the earlier version, which was out of date.

## Done

- [x] **Flipbikes site on Vercel.** `www.flipbikes.co.nz` serves from Vercel.
- [x] **Apex redirect.** `flipbikes.co.nz` 301s to `www`, wildcard on, paths kept
      (`/for-sale` → `/for-sale`). Added in cPanel → Redirects with **Do Not
      Redirect www** so it can never loop. No DNS change, so no certificate gap.
      The old `send.php` form is now unreachable — that is the form that was
      silently swallowing enquiries.
- [x] **Flipbikes contact form works.** `flipbikes.co.nz` verified in Resend
      (CNAME `rsend`, CNAME `send`, TXT `resend._domainkey`). Sending-only API
      key scoped to flipbikes.co.nz, held in Vercel as `RESEND_API_KEY`
      (Production, Secret). Redeployed. A live test enquiry showed **Delivered**
      to craig@betterservice.co.nz.
- [x] **The 13 recovered lost enquiries** have been sent to Craig.
- [x] **Both zones recorded** — `DNS-ZONE-betterservice.md` (43 records) and
      `DNS-ZONE-flipbikes.md` (24 records). The flipbikes one is the rollback
      reference.

## The one thing with a clock on it: transfer the domains

**HostPapa confirmed (29 Sep) this does NOT need a support ticket.** Their steps:

1. HostPapa dashboard → **My Domains** → **Details**
2. **Contacts tab** — check registrant and admin details. *The EPP/UDAI code is
   sent to the **admin contact email**, nothing else.*
3. Make sure the domain is **unlocked** (already done for both)
4. **Transfer EPP tab** — sits between the Lock and DNS Zone Editor tabs
5. **Send Transfer Code**
6. Code arrives at the admin contact address; hand it to the new registrar
7. Transfer takes **5–7 business days**

**Worth doing first:** check what the admin contact email actually is. If it is
one Craig alone reads, update it to one Ben reads *before* clicking Send — then
the codes arrive without a second round trip. Changing the **admin** contact is
the low-risk one; leave the registrant alone. (.nz is not under ICANN's 60-day
post-change transfer lock, but there is no reason to test that.)

Then: choose an NZ registrar where **both Ben and Craig can log in** — the single
point of access is the actual problem being escaped. HostPapa charges $51.99/yr
per domain; most NZ registrars are about half.

## After the transfer completes

- [ ] Build both zones in Vercel DNS from `DNS-PLAN.md`
- [ ] **Copy every mail record unchanged.** Nothing about mail changes at this
      step. Mail keeps flowing to HostPapa until Fastmail is live and tested.
- [ ] Run `python3 dns-check.py` first and keep the output as the baseline
- [ ] Switch nameservers to Vercel, **betterservice first** — its zone is
      otherwise unchanged, so anything that breaks is the move itself
- [ ] Verify: both sites load, an invoice sends and arrives, a MailerLite test
      sends, Craig's iPad still gets mail
- [ ] Then flipbikes. **Point the apex at Vercel at this step**, not before —
      with Vercel running DNS it issues the certificate itself, with no gap.
      Then remove the cPanel redirect, which has done its job.
- [ ] Re-run `dns-check.py` and compare

## Then the mailboxes

- [ ] Two real mailboxes (not forwarders): `craig@betterservice.co.nz` and
      `sales@flipbikes.co.nz`, both live in Apple Mail on Craig's iPad
- [ ] Fastmail Business, both domains, two users (~US$120/yr)
- [ ] **Import over IMAP while the HostPapa mailboxes are still alive.** Needs
      Craig's two mailbox passwords. Once HostPapa is cancelled it is gone.
- [ ] Switch MX, rewrite SPF, add Fastmail DKIM — one change, together
- [ ] Repoint the iPad; watch mail arrive for several days
- [ ] Only then cancel HostPapa. **31 Oct is a billing date, not a technical
      one** — the paid-up period is free overlap, so use it.

## Security — do this regardless

- [ ] **Craig emailed his HostPapa account password in plain text** (30 Sep,
      "Re: Hostpapa"). It is sitting in Gmail. Change it, and ask Craig not to
      send passwords by email.
- [ ] Rotate `CRON_SECRET` — it went through a chat transcript. Three places.

## Found along the way, not blocking

- [ ] Two of nine Flipbikes customers could not work out how to buy
- [ ] Every Flipbikes page carries a Google Analytics tag and a Meta Pixel from
      the original Webflow build. Either Craig can see that data, or they are
      liability with no upside.
- [ ] Ask Craig what `cash4bikes.betterservice.co.nz` is for
