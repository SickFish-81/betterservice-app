# Moving both zones to Cloudflare

Captured live from public DNS on 28 Sep 2026, after the Flipbikes site was
already running on Vercel but before any nameserver change.

`DNS-RECORDS.md` is the snapshot of how things looked when they worked. This
file is the plan. Read that one if something breaks and you need to put it back.

**Both domains are in the same HostPapa account.** Nameservers for both are
`ns1.hostpapa.com` / `ns2.hostpapa.com`.

---

## The one rule for step one

**Nothing about mail changes when DNS moves.**

Copy the HostPapa MX, SPF and DKIM records across *exactly as they are*, so mail
keeps flowing to HostPapa after the nameserver switch. The only thing step one
changes is *who answers DNS queries*. If a customer or Craig notices anything at
all, something has gone wrong.

Mail moves in step two, as its own deliberate switch, once Fastmail exists and
has been tested. Two changes on the same day means you can't tell which one
broke it.

---

## betterservice.co.nz

### Copy across unchanged

| Type | Name | Value | Why it matters |
|---|---|---|---|
| A | `@` | `216.150.1.1` | the website, on Vercel |
| A | `www` | `216.150.1.1` | same |
| TXT | `@` | `mailerlite-domain-verification=394da5897c718356d428b45a6366d5b8910fde31` | MailerLite ownership |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | monitoring only, no enforcement |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDa5Y+4lWWgyypdlRiSRVinmqQ…` | **Resend DKIM. Signs every invoice email.** |
| MX | `send` | `10 feedback-smtp.ap-northeast-1.amazonses.com` | Resend bounce handling |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | Resend sending authority |
| TXT | `litesrv._domainkey` | `v=DKIM1;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC6SIHVq/vJmsR3R3saPiVGNPfMZ1Qv9…` | MailerLite DKIM |

### Copy across now, remove in step two

| Type | Name | Value |
|---|---|---|
| MX | `@` | `0 mx.betterservice.co.nz.cust.a.hostedemail.com` |
| TXT | `default._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtQFod5fYmqu1amPFk4cujvxioJvW…` |
| A | `mail` | `216.40.42.5` |

### Leave behind

`webmail`, `ftp`, `cpanel` — all `66.102.132.100`. These only ever pointed at
HostPapa's own control panels. Nothing on either site links to them.

### The SPF line

Today:

```
v=spf1 include:_spf.mlsend.com ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all
```

Copy it verbatim in step one. Rewrite it in step two to:

```
v=spf1 include:_spf.mlsend.com include:spf.messagingengine.com ~all
```

MailerLite stays. The three HostPapa parts go. Resend is deliberately absent —
it sends from the `send.` subdomain, which carries its own SPF.

**Change this last and check it hardest.** A wrong SPF line does not bounce mail,
it quietly lands invoices in spam, and nobody notices for weeks.

---

## flipbikes.co.nz

This zone does change at step one, because the site itself is moving.

### The actual cutover

| Type | Name | From | To |
|---|---|---|---|
| A | `@` | `66.102.132.28` (HostPapa nginx) | Vercel |
| A/CNAME | `www` | CNAME to apex | whatever Vercel issues |

Add `flipbikes.co.nz` as a domain on the Vercel project **first**, and use the
exact record values Vercel gives you on that screen. Do not copy the
betterservice IP across on the assumption it is the same.

### Copy across now, remove in step two

| Type | Name | Value |
|---|---|---|
| MX | `@` | `0 mx.flipbikes.co.nz.cust.a.hostedemail.com` |
| TXT | `@` | `v=spf1 include:_spf.hostedemail.com ~all` |
| TXT | `default._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvhN1V8oI1nc0OKROptyCvYbx9mWGYD8f…` |
| A | `mail` | `216.40.42.5` |

### Leave behind

`webmail`, `ftp`, `cpanel` — all `66.102.132.28`.

### Add while you are in there

Resend verification records for `flipbikes.co.nz`. **The contact form does not
work until this is done** — `api/send.js` sends as `noreply@flipbikes.co.nz`,
and Resend refuses to send from an unverified domain. Get the records from the
Resend dashboard when you add the domain; they will be a DKIM TXT and an SPF
record on a subdomain, same shape as the betterservice ones above.

---

## Traps

**1. Do not turn the orange cloud on for anything pointing at Vercel.**
Cloudflare proxying in front of Vercel means two CDNs arguing about caching and
certificates. Every A and CNAME for either website must be set to **DNS only**
(grey cloud). This is the single easiest way to break both sites at once.

**2. There may be a wildcard record.**
`www.betterservice.co.nz` currently answers with the apex MX, TXT *and* NS
records, which is not normal for a plain A record. That pattern usually means a
`*` wildcard entry in the zone. Cloudflare's importer will not find it, because
a wildcard cannot be enumerated from outside. **Open HostPapa's DNS editor and
read the zone directly before you switch**, and check whether the same applies
to flipbikes, where `www` is a CNAME to the apex.

**3. Cloudflare's import is a guess, not a copy.**
When you add a domain it scans public DNS and builds what it can see. It cannot
see records nobody has queried. Check its result against the tables above, line
by line, before repointing nameservers.

**4. Ignore the `_acme-challenge` records.**
Both zones have one. They are Let's Encrypt validation tokens, they are
temporary, and copying them achieves nothing.

**5. Lower the TTLs a day before, not on the day.**
Whatever HostPapa's records are set to, drop them to 300 seconds a day ahead.
If something is wrong after the switch you want to be able to undo it in five
minutes rather than waiting out an old TTL.

---

## Order

1. Read HostPapa's zone editor directly, confirm nothing here is missing
2. Drop TTLs, wait a day
3. Build both zones in Cloudflare, mail records copied exactly as-is
4. Add flipbikes.co.nz to the Vercel project, use its record values
5. Repoint nameservers at Cloudflare, one domain at a time, betterservice first
6. Verify: both sites load, an invoice email sends and arrives, a MailerLite
   test sends, Craig's iPad still gets mail
7. Only then start on Fastmail

Betterservice first because its zone is unchanged apart from the nameservers, so
if anything goes wrong the cause is the move itself and not the content. Flipbikes
second, because that one is also changing where the site lives.

---

**SUPERSEDED 28 Sep 2026.** Cloudflare was chosen for its free Email Routing,
and that stopped being relevant once Craig turned out to need real mailboxes
(Fastmail) rather than forwarding. DNS is going to Vercel instead. See
`DNS-PLAN.md`.
