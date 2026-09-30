# betterservice.co.nz — the real zone, read from cPanel

Captured 30 Sep 2026 from cPanel Zone Editor, which is the authoritative source.
43 records. `DNS-RECORDS.md` was built from an outside-in DNS sweep and **got two
record TYPES wrong** — see "What the outside view missed" below.

Nameservers: `ns1.hostpapa.com`, `ns2.hostpapa.com`. TTL 14400 unless noted.

## The site

| Name | TTL | Type | Value |
|---|---|---|---|
| `betterservice.co.nz.` | 14400 | A | `216.150.1.1` |
| `www` | 14400 | **CNAME** | `betterservice.co.nz` |

## Mail — HostPapa (dies with the account)

| Name | TTL | Type | Value |
|---|---|---|---|
| `betterservice.co.nz.` | 14400 | MX | `0 mx.betterservice.co.nz.cust.a.hostedemail.com` |
| `mail` | 14400 | **CNAME** | `mail.betterservice.co.nz.cust.a.hostedemail.com` |
| `default._domainkey` | 14400 | TXT | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtQFod5fYmqu1amPFk4cujvxioJvW…` |
| `_mailchannels` | 14400 | TXT | `v=mc1 auth=hostpapa` |

`_mailchannels` is what authorises HostPapa's outbound relay to send as this
domain. It is the same relay that blocked the Flip Bikes contact form with
`550 5.7.1 Message blocked`. Dies with HostPapa; do not carry it.

## Mail — Resend (invoices). KEEP.

| Name | TTL | Type | Value |
|---|---|---|---|
| `resend._domainkey` | 14400 | TXT | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDa5Y+4lWWgyypdlRiSRVinmqQ…` |
| `send` | 14400 | MX | `10 feedback-smtp.ap-northeast-1.amazonses.com` |
| `send` | 14400 | TXT | `v=spf1 include:amazonses.com ~all` |

## Mail — MailerLite. KEEP.

| Name | TTL | Type | Value |
|---|---|---|---|
| `litesrv._domainkey` | 14400 | **CNAME** | `litesrv._domainkey.mlsend.com` |
| `betterservice.co.nz.` | 14400 | TXT | `mailerlite-domain-verification=394da5897c718356d428b45a6366d5b8910fde31` |

## Policy

| Name | TTL | Type | Value |
|---|---|---|---|
| `betterservice.co.nz.` | 14400 | TXT | `v=spf1 include:_spf.mlsend.com ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all` |
| `_dmarc` | 14400 | TXT | `v=DMARC1; p=none;` |

**8 CAA records**, TTL 60, `issue` and `issuewild` for each of: `sectigo.com`,
`globalsign.com`, `letsencrypt.org`, `pki.goog`. Vercel issues through Let's
Encrypt, which is permitted, so these do not block the move — but if they are
rebuilt anywhere, `letsencrypt.org` must survive or certificates stop renewing.

## HostPapa infrastructure — all dies with the account

A records on `66.102.132.100`: `ftp`, `cpanel`, `webdisk`, `cpcalendars`,
`cpcontacts`, `whm`, `webmail`.
AAAA records on `2605:6f00:1234:700:1::30e`: the same set plus `ipv6`.

## Leftovers

`_cpanel-dcv-test-record`, and `_acme-challenge` TXT records for the apex,
`webdisk`, `cpanel`, `webmail`, **`cash4bikes`** and **`www.cash4bikes`**.

**`cash4bikes.betterservice.co.nz` has certificate-validation records but no A
or CNAME record at all.** Something was published there once and is now gone.
Worth asking Craig before anything is torn down, in case it is meant to exist.

---

## What the outside view missed

`DNS-RECORDS.md` and the first draft of `DNS-PLAN.md` were built by querying
public DNS. That resolves values but hides record types, and it cannot see a
record nobody queries. Two would have broken things if rebuilt from the sweep:

- **`mail` is a CNAME, not an A record.** The sweep saw `216.40.42.5` because
  that is what the CNAME resolves to. Rebuilding it as an A record pins mail to
  one IP that HostPapa is free to change.
- **`litesrv._domainkey` is a CNAME to `litesrv._domainkey.mlsend.com`, not an
  inline TXT key.** Rebuilding it as TXT breaks MailerLite DKIM signing, which
  fails silently into spam folders.

Invisible from outside entirely: all 8 CAA records, `_mailchannels`, every AAAA
record, `webdisk`/`cpcalendars`/`cpcontacts`/`whm`, and the cash4bikes leftovers.

The lesson is already in DECISIONS.md in other forms: a view from outside tells
you what resolves, not what is configured.
