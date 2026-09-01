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

## Before touching DNS

- [ ] **Write down the current MX records.** Craig's email is on this domain
      (`craig@betterservice.co.nz`), and so is the invoice sender
      (`admin@betterservice.co.nz`). Point the **A record** at Vercel and leave
      **MX** alone, or the mail dies with the website.
- [ ] **Check the SPF / DKIM TXT records** that Resend uses to send invoices.
      They must survive the move or invoice emails start landing in spam.
- [ ] Add the domain in Vercel, then update the Supabase **Site URL** and
      **Redirect URLs** to the new domain (keep the vercel.app entries so
      preview deployments still work).
- [ ] Tell the team they'll be signed out once — sessions are per-domain.
