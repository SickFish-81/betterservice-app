# betterservice.co.nz — DNS as it stands, captured 24 Sep 2026

Taken live from public DNS before any change, so there is something exact to
rebuild from. If a move goes wrong, this is what it looked like when it worked.

Nameservers today: `ns1.hostpapa.com`, `ns2.hostpapa.com`. **Every record below
lives inside the HostPapa account.** Closing that account deletes all of them at
once — the website, the invoice email, the mailboxes and the marketing list, not
just the old web hosting.

---

## KEEP — nothing to do with HostPapa, must survive the move

| Type | Name | Value | What it is |
|---|---|---|---|
| A | `@` | `216.150.1.1` | the website, served by **Vercel** |
| A | `www` | `216.150.1.1` | same |
| TXT | `resend._domainkey` | `p=MIGfMA0…` | **Resend** DKIM — signs every invoice email |
| MX | `send` | `10 feedback-smtp.ap-northeast-1.amazonses.com` | Resend bounce handling |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | Resend sending |
| TXT | `litesrv._domainkey` | `v=DKIM1;p=MIGf…` | **MailerLite** DKIM |
| TXT | `@` | `mailerlite-domain-verification=394da58…` | MailerLite ownership |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | policy, currently monitoring only |

## DIES WITH HOSTPAPA — only needed while mail is hosted there

| Type | Name | Value |
|---|---|---|
| MX | `@` | `0 mx.betterservice.co.nz.cust.a.hostedemail.com` |
| A | `mail` | `216.40.42.5` |
| A | `webmail` | `66.102.132.100` |
| A | `ftp` | `66.102.132.100` |
| A | `cpanel` | `66.102.132.100` |
| TXT | `default._domainkey` | `v=DKIM1; k=rsa; p=MIIBIj…` (HostPapa mail DKIM) |

## THE SPF LINE — has to be rewritten, not copied

Today:

```
v=spf1 include:_spf.mlsend.com ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all
```

Three senders are mixed into one line:

- `include:_spf.mlsend.com` — MailerLite. **Keep.**
- `include:_spf.hostedemail.com`, `ip4:66.102.132.100`, `ip4:65.39.193.20` — HostPapa mail. **Remove once mail moves**, and add whatever the new host needs.
- Resend is not here on purpose: it sends from the `send.` subdomain, which has its own SPF.

Getting this wrong is the classic way invoices start landing in spam without
anyone noticing, so it is the record to check last and hardest.

---

## Order of operations

1. **Find the registrar first.** If the domain is registered through HostPapa,
   it lives inside the account being cancelled. Check at dnc.org.nz/whois.
2. **Move DNS to a free host** (Cloudflare or Vercel), copying every record
   above **including the HostPapa mail ones**, so nothing changes behaviour.
   Repoint the nameservers, let it settle, verify.
3. **Then move the mailboxes**, update MX / SPF / DKIM, verify mail both ways.
4. **Only then cancel HostPapa.**

DNS first and email second, because moving DNS is reversible in minutes and
moving mailboxes is not. Do not cancel anything until mail has been arriving at
the new host for a few days.
