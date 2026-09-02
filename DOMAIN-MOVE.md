# Moving the app to betterservice.co.nz

_Crawled the old site 1 Sep 2026. Seven pages, all live (HTTP 200)._

## What's on the old site

| Old URL | Title | Words | Notes |
|---|---|---|---|
| `/` | Betterservice home Index | — | Meta description is about **farm help, farm management and being a registered electrician** — wrong business, likely years stale |
| `/used-honda-atv-quad-for-sale-tepuke-tauranga-bop.php` | Betterservice Tepuke used bikes atv for sale | 387 | **The valuable one.** URL carries the exact local search terms |
| `/atv-servicing.php` | Betterservice mechanics | 408 | "quick turnaround our specialty" |
| `/bosch-batteries.php` | *(wrong title — see below)* | 413 | URL and nav already say Bosch; the page heading still says NEUTON POWER BATTERIES |
| `/FLIP-recessed-bike-mounts.php` | Betterservice FLIP recessed bike trailer mounts | 515 | NZ-made recessed trailer mounts — Craig's own product |
| `/other-equipment-for-sale.php` | *(wrong title)* | 182 | Thin |
| `/contact-betterservice.php` | Betterservice Contact page | 505 | |

## Problems worth not repeating

- **Three pages share one title** — "Betterservice FLIP recessed bike trailer mounts" is the title of the batteries page, the mounts page AND the other-equipment page. Google treats duplicate titles as a signal the pages aren't distinct.
- **Three pages share one meta description**, the FLIP one.
- **The homepage description describes a different business** — farm relief, farm management, electrical work. If Google shows a description under the listing today, that's what people read.
- The old site was already mid-rebrand: Neuton → Bosch done in the URL and nav, not in the page.

## Redirect map for the move

Old URLs will 404 once the domain points at Vercel. These redirects preserve
whatever ranking those URLs have. Add to `next.config.mjs` as permanent (308).

| Old | New |
|---|---|
| `/used-honda-atv-quad-for-sale-tepuke-tauranga-bop.php` | `/for-sale` |
| `/atv-servicing.php` | `/` |
| `/bosch-batteries.php` | `/batteries` |
| `/other-equipment-for-sale.php` | `/for-sale` |
| `/contact-betterservice.php` | `/enquiry` |
| `/FLIP-recessed-bike-mounts.php` | **decide** — see below |

**FLIP mounts has no home on the new site.** It's 515 words about a product
Craig makes, on a URL that's been indexed for years. Options: build a page for it
on the new site (best — keeps the traffic and the product is his), redirect to
flipbikes.co.nz (loses the value to another domain), or let it 404.

## The live DNS, checked 2 Sep 2026

Nameservers are **HostPapa** (`ns1.hostpapa.com`, `ns2.hostpapa.com`), so every
change below is made in the HostPapa DNS panel.

| Record | Current value | Move it? |
|---|---|---|
| `A` @ | `66.102.132.100` (old site) | **YES → Vercel** |
| `CNAME` www | `betterservice.co.nz` | **YES → Vercel** |
| `MX` @ | `mx.betterservice.co.nz.cust.a.hostedemail.com` | **NO — Craig's mail** |
| `TXT` @ (SPF) | `v=spf1 include:_spf.mlsend.com ip4:66.102.132.100 +ip4:65.39.193.20 +include:_spf.hostedemail.com ~all` | **NO** |
| `TXT` @ | `mailerlite-domain-verification=…` | **NO** |
| `TXT` `resend._domainkey` | Resend's DKIM public key | **NO — invoice email** |
| `TXT` `send` | `v=spf1 include:amazonses.com ~all` | **NO — Resend** |
| `MX` `send` | `feedback-smtp.ap-northeast-1.amazonses.com` | **NO — Resend bounces** |
| `TXT` `_dmarc` | `v=DMARC1; p=none;` | **NO** |

**Why the email survives.** Resend sends the rent invoices as
`admin@betterservice.co.nz`, but none of the records that make that work sit on
the A record. The bounce path and its SPF live on the `send.` subdomain, and the
signature that proves the mail is really from this domain is the DKIM key at
`resend._domainkey`. Craig's own mailbox is on the root `MX`. Change the A record
and the www CNAME, leave the rest alone, and nothing that carries mail moves.

The SPF at the root still lists `ip4:66.102.132.100` — the old web server, which
could send from the PHP contact form. Once the site is off that box the entry is
stale but harmless. Tidy it up later, not during the move.

## Still to do at the move

- [ ] Add `betterservice.co.nz` and `www.betterservice.co.nz` in Vercel, and use
      the A / CNAME values Vercel gives you.
- [ ] Update Supabase **Site URL** and **Redirect URLs** to the new domain —
      keep the `.vercel.app` entries so preview deploys still log in. This is
      what sent the password reset to the wrong place last time.
- [ ] Tell the team they'll be signed out once. A login session belongs to the
      domain it was created on, so moving domain ends it.
- [ ] After it resolves: check `/robots.txt`, `/sitemap.xml`, and that
      `https://betterservice.co.nz/atv-servicing.php` lands on the homepage.
- [ ] Submit the domain in Google Search Console and upload the sitemap.

## Done (in the code, waiting on DNS)

- 308 redirects for all seven old URLs — `next.config.mjs`
- `/flip-recessed-bike-mounts` — unlinked, indexable, holds the old page's copy
- Per-page titles and descriptions on all six public pages
- `robots.txt` excluding every staff route; `sitemap.xml` listing the public six
