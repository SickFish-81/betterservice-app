# flipbikes.co.nz — the real zone, read from cPanel

Captured 30 Sep 2026, before any change. 24 records, TTL 14400 unless noted.
Nameservers: `ns1.hostpapa.com`, `ns2.hostpapa.com`.

**This is the rollback reference.** If the Vercel cutover goes wrong, these are
the values to put back.

## The site — THESE ARE THE ONES CHANGING

| Name | TTL | Type | Value BEFORE | Value AFTER |
|---|---|---|---|---|
| `flipbikes.co.nz.` | 14400 | A | `66.102.132.28` | `216.150.1.1` (Vercel) |
| `www` | 14400 | CNAME | `flipbikes.co.nz` | `58430e31f7244462.vercel-dns-016.com` |

## Mail — untouched by the site cutover

| Name | Type | Value |
|---|---|---|
| `flipbikes.co.nz.` | MX | `0 mx.flipbikes.co.nz.cust.a.hostedemail.com` |
| `mail` | CNAME | `mail.flipbikes.co.nz.cust.a.hostedemail.com` |
| `flipbikes.co.nz.` | TXT | `v=spf1 include:_spf.hostedemail.com ~all` |
| `_mailchannels` | TXT | `v=mc1 auth=hostpapa` |
| `default._domainkey` | TXT | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvhN1V8oI1nc0OKROptyCvYbx9mWGYD8f…` |

## Being added — Resend, so the contact form can send

| Name | Type | Value |
|---|---|---|
| `resend._domainkey` | TXT | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDF61lwFKui1zWu5M6fDgw6R0J71y4GBORNjQOMukrmZxpU1wa4gdXR33Ogi0aarWreWMUpi5kGoHUEAwf4qqTmDJoTSa5mwjQUFS4qxA1145pRL21iebNqeroKnLvDfQ9qBoU6CeY/tbEMIRn/s6RrxvmsRttkMH7La5+660rVjwIDAQAB` |
| `rsend` | CNAME | `rsend-apne1.forge.rmta.net` |
| `send` | CNAME | `send.forge.rmta.net` |

## CAA — 8 records, TTL 60

`issue` and `issuewild` for each of `sectigo.com`, `globalsign.com`,
`letsencrypt.org`, `pki.goog`. **Vercel issues through Let's Encrypt, which is
permitted**, so the cutover is not blocked. Do not remove `letsencrypt.org`.

## HostPapa infrastructure — dies with the account

A records on `66.102.132.28`: `ftp`, `cpcalendars`, `cpcontacts`, `webdisk`,
`whm`, `cpanel`, `webmail`.

## Leftovers

`_cpanel-dcv-test-record`, `_acme-challenge`.

---

## Why this cutover is low risk

The Vercel copy and the HostPapa original serve **the same site**. Until every
resolver has picked up the new address, some visitors land on HostPapa and some
on Vercel — and they cannot tell the difference. A split-brain window that would
normally be the whole problem is, here, harmless.

The one real risk is the certificate. Vercel cannot issue for flipbikes.co.nz
until DNS points at it, so there is a gap of up to a few minutes where Vercel
answers without a valid certificate and a browser would refuse. That is why
`www` goes first as a canary: it proves the certificate path works on the name
almost nobody types, before the apex follows.

TTLs are dropped to 300 on the two changing records as they change, so a
rollback takes five minutes instead of four hours.
