# Getting both domains off HostPapa

Supersedes `CLOUDFLARE-PLAN.md`, which was written on two assumptions that
turned out to be wrong. `DNS-RECORDS.md` is still the snapshot of how the zone
looked when it worked. Read that one if something breaks.

## Why this changed twice

**Cloudflare was chosen for Email Routing.** Free forwarding for `craig@` and
`sales@`. Then message headers showed Craig does not use forwarding at all: he
has two real mailboxes on HostPapa's mail platform, opened in Apple Mail on his
iPad, authenticating and sending directly. Forwarding cannot replace that, so
the mailboxes are going to **Fastmail**, and Cloudflare's one advantage over
Vercel disappeared with them.

**DNS-first was chosen because repointing nameservers seemed unavoidable.** It
needs the HostPapa dashboard, and nobody reliably has that login. But the .nz
rules say a provider "must not decline or delay a domain name holder's request
to transfer its domain name to another provider by withholding the
authorisation code or otherwise", and must supply it free. The WHOIS registrant
is Craig Barrett at his own Gmail, not a HostPapa address. **He can request both
codes from support directly.** So the transfer moves to the front and the
dashboard drops out of the critical path.

## What actually matters

Not the 31 October email renewal. **Getting the domains out of that account.**
While they sit inside it, a lapsed card or a suspension puts them at risk, and a
lost `betterservice.co.nz` costs the business its email, its website and its
identity. $54 of email renewing is an annoyance. Losing the domain is not
recoverable.

Letting the account lapse is not an option and never was. Nothing picks up an
abandoned domain. The registry has `ns1.hostpapa.com` recorded against both
names, and that only changes when somebody deliberately changes it.

---

## Order

### 1. Build both zones at Vercel

Needs nothing from HostPapa. Vercel DNS is free, uses its own nameservers, and
supports A, AAAA, ALIAS, CNAME, MX, TXT, NS, SRV and CAA. Default TTL 60s.

**Mail records get copied across exactly as they are.** Nothing about mail
changes at this stage. Mail keeps flowing to HostPapa until Fastmail is live and
tested. Two changes on one day and you cannot tell which one broke it.

### 2. Craig requests both authorisation codes

He contacts HostPapa as the registrant and asks for the code for
betterservice.co.nz and flipbikes.co.nz. 16 characters, valid 30 days, single
use, free.

### 3. Transfer both to a new NZ registrar

Into an account Craig and Ben both have. HostPapa charges $51.99 a year per
domain; most NZ registrars are roughly half that.

### 4. Set nameservers to Vercel, at the new registrar

**A transfer carries the nameserver delegation with it unchanged.** Straight
after the transfer both domains still say `ns1.hostpapa.com`, and those servers
keep answering while the account is alive. Change the nameservers promptly and
verify before touching anything else.

### 5. Fastmail, then MX

Two mailboxes. Import the existing mail over IMAP **while the HostPapa accounts
are still alive** — that needs the mailbox passwords, which Craig has in his
iPad, not the dashboard. Then switch MX, SPF and DKIM together and repoint his
iPad.

### 6. Cancel HostPapa

Only once mail has been arriving at Fastmail for several days.

Craig does this, through support, the same way he requests the codes. Nobody
else has dashboard access to that account and nothing in this plan requires it.

---

## betterservice.co.nz

### Copy across unchanged

| Type | Name | Value | What it does |
|---|---|---|---|
| A | `@` | `216.150.1.1` | the website, on Vercel |
| CNAME | `www` | `betterservice.co.nz` | same site, via the apex |
| TXT | `@` | `mailerlite-domain-verification=394da5897c718356d428b45a6366d5b8910fde31` | MailerLite ownership |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | monitoring only |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDa5Y+4lWWgyypdlRiSRVinmqQ…` | **Resend DKIM. Signs every invoice email.** |
| MX | `send` | `10 feedback-smtp.ap-northeast-1.amazonses.com` | Resend bounce handling |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | Resend sending authority |
| TXT | `litesrv._domainkey` | `v=DKIM1;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC6SIHVq/vJmsR3R3saPiVGNPfMZ1Qv9…` | MailerLite DKIM |

Once the domain is on Vercel's nameservers, the apex and www can be handled
natively by adding the domain to the project rather than pinning the IP by hand.
Do that only after the move is verified working. One change at a time.

### Copy now, remove at step 5

| Type | Name | Value |
|---|---|---|
| MX | `@` | `0 mx.betterservice.co.nz.cust.a.hostedemail.com` |
| TXT | `default._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtQFod5fYmqu1amPFk4cujvxioJvW…` |
| A | `mail` | `216.40.42.5` |

### Leave behind

`webmail`, `ftp`, `cpanel`, all `66.102.132.100`. HostPapa control panels only.

### The SPF line

Today:

```
v=spf1 include:_spf.mlsend.com ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all
```

Copy verbatim now. At step 5 rewrite to:

```
v=spf1 include:_spf.mlsend.com include:spf.messagingengine.com ~all
```

MailerLite stays, the three HostPapa parts go. Resend is deliberately absent: it
sends from `send.`, which carries its own SPF.

**Change this last and check it hardest.** A wrong SPF line does not bounce
mail, it quietly lands invoices in spam and nobody notices for weeks.

---

## flipbikes.co.nz

This zone does change, because the site itself is moving to Vercel.

### The cutover

Both domains were added to the `flipbikes-site` Vercel project on 28 Sep 2026.
They sit at "Invalid Configuration" until DNS points at them, which is exactly
what we want for now. These are the values Vercel issued:

| Type | Name | From | To |
|---|---|---|---|
| A | `@` | `66.102.132.28` (HostPapa nginx) | `216.150.1.1` |
| CNAME | `www` | CNAME to apex | `58430e31f7244462.vercel-dns-016.com` |

The apex IP is the same as betterservice.co.nz, which is worth knowing rather
than assuming. The `www` CNAME target is unique to this project — do not copy
it anywhere else.

**Apex stays primary.** Vercel offers to redirect the apex to `www` and ticks
that box by default. It was deliberately unticked for both entries, because
today `flipbikes.co.nz` is the address on Craig's email signature, on the
Betterservice FLIP page and on anything printed. Turning that into a redirect
is a change nobody asked for.

### Copy now, remove at step 5

| Type | Name | Value |
|---|---|---|
| MX | `@` | `0 mx.flipbikes.co.nz.cust.a.hostedemail.com` |
| TXT | `@` | `v=spf1 include:_spf.hostedemail.com ~all` |
| TXT | `default._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvhN1V8oI1nc0OKROptyCvYbx9mWGYD8f…` |
| A | `mail` | `216.40.42.5` |

### Leave behind

`webmail`, `ftp`, `cpanel`, all `66.102.132.28`.

### Add — Resend

`flipbikes.co.nz` was added to Resend on 28 Sep 2026 (Tokyo / ap-northeast-1,
return-path `send`, matching betterservice). It sits unverified until these
records exist, which is fine and inert. **The contact form stays broken until
they do** — `api/send.js` sends as `noreply@flipbikes.co.nz` and Resend refuses
to send from an unverified domain.

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDF61lwFKui1zWu5M6fDgw6R0J71y4GBORNjQOMukrmZxpU1wa4gdXR33Ogi0aarWreWMUpi5kGoHUEAwf4qqTmDJoTSa5mwjQUFS4qxA1145pRL21iebNqeroKnLvDfQ9qBoU6CeY/tbEMIRn/s6RrxvmsRttkMH7La5+660rVjwIDAQAB` |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` |
| CNAME | `send` | `send.forge.rmta.net` |

**Copy the DKIM value from the Resend dashboard, not from this file.** One wrong
character and signing fails silently. It is recorded here so the record set is
complete, not so it can be retyped.

The two CNAME hostnames were verified by resolving them: `rsend-apne1` and
`send.forge.rmta.net` both exist, while the obvious-looking
`rsend-ap-northeast-1` is NXDOMAIN. Resend's UI elides the middle of long
values, so these were reconstructed and then checked rather than assumed.

Note this is **not** the same shape as betterservice's Resend setup, which uses
`MX send -> feedback-smtp.ap-northeast-1.amazonses.com` and an SES SPF record.
Resend changed its sending infrastructure between the two domains being added.
Do not copy betterservice's records across.

---

## When the flipbikes zone goes live, in this order

The contact form has two blockers, not one. Both were confirmed on 28 Sep 2026,
and neither can be cleared before the DNS records exist.

1. **Add the three Resend records** to the flipbikes zone (above), then click
   "I've added the records" in Resend. The domain currently sits at
   **Not Started**.
2. **Wait for it to verify.** Until it does, Resend will not offer
   flipbikes.co.nz when scoping an API key, because a key scoped to an
   unverified domain could not send anyway.
3. **Create the API key** — Resend → API keys → Create. Sending access only,
   restricted to flipbikes.co.nz. Not full access, and not unscoped: an
   unscoped key can also send as betterservice.co.nz, which is Craig's
   invoicing. The existing `betterservice-app` key stays where it is and is
   not reused here.
4. **Add it to Vercel** as `RESEND_API_KEY` on the flipbikes-site project,
   Production, marked Sensitive. The name is exact — it is what `api/send.js`
   reads. The project currently has **no environment variables at all**.
5. **Redeploy.** Adding an environment variable does nothing to what is already
   running; the function keeps the config it was deployed with. Same trap as
   the `NEXT_PUBLIC_` one on Betterservice: it looks like it worked and changes
   nothing.
6. **Test the form** on the live site and check it appears in Resend's logs.

---

## Traps

**~~There may be a wildcard record.~~ Closed 28 Sep 2026. There is no wildcard.**
The suspicion came from `www.betterservice.co.nz` answering with the apex MX,
TXT and NS records, which a plain A record should not do. That was a bug in the
sweep script, which filtered out CNAME answers: `www` is a CNAME to the apex, so
those were simply the apex's own records being followed through it. Normal DNS.

Ruled out properly by querying names nobody has ever registered
(`zq7x4k2mnv9.betterservice.co.nz` and similar) on both domains. All returned
NXDOMAIN. A wildcard would have answered. **This needs no access to HostPapa and
does not need to be checked again.**

**Any importer is a guess, not a copy.** Anything that builds a zone by scanning
public DNS can only see records somebody has queried. Check the result against
the tables above line by line.

**Ignore the `_acme-challenge` records.** Both zones have one. Temporary Let's
Encrypt tokens, no value in copying.

**The TTLs cannot be dropped in advance.** That would normally be the move — set
them low a day ahead so a mistake is undoable in minutes. It needs the HostPapa
dashboard, which is Craig's account and not available to us. So the nameserver
change is a one-way door for as long as the old values stay cached. Verify
before switching, not after.

**Verify before moving on.** Both sites load, an invoice email sends and
arrives, a MailerLite test sends, Craig's iPad still gets mail. In that order,
every time.
