# HostPapa migration — what is left

One page. The detail and the exact record values are in `DNS-PLAN.md`.
Last updated 28 Sep 2026.

## Done

- [x] Flipbikes site lifted off HostPapa and running on Vercel
      (`flipbikes-site.vercel.app`), verified page by page against the live site
- [x] Contact form rebuilt as a Vercel function, replacing `send.php`
- [x] 13 lost enquiries recovered from bounce messages
- [x] Both domains added to the Vercel project, record values captured
- [x] `flipbikes.co.nz` added to Resend, its three records captured and the
      hostnames verified by resolution
- [x] `dns-check.py` written, passing against the live state
- [x] Authorisation codes requested from Craig (28 Sep)
- [x] Wildcard record ruled out — there isn't one

## Waiting on Craig

- [ ] **Two authorisation codes**, one per domain. Everything below waits on
      these. Valid 30 days, single use. Requested 28 Sep.

## Then, in order

### 1. Transfer both domains
- [ ] Choose an NZ registrar. HostPapa charges $51.99/yr per domain, most
      others are about half. Pick one where **both Ben and Craig can log in** —
      single-person access is the problem being escaped.
- [ ] Transfer `betterservice.co.nz` and `flipbikes.co.nz`
- [ ] Note the delegation comes across unchanged: both will still say
      `ns1.hostpapa.com` immediately after

### 2. Build the zones and switch nameservers
- [ ] Run `python3 dns-check.py` and keep the output as the baseline
- [ ] Build both zones in Vercel DNS from the tables in `DNS-PLAN.md`
- [ ] **Copy every mail record unchanged.** Nothing about mail changes here.
      Mail keeps flowing to HostPapa until Fastmail is live and tested.
- [ ] Switch nameservers to Vercel, **betterservice first** — its zone is
      unchanged apart from the nameservers, so anything that breaks is the move
      itself and not the content
- [ ] Verify: both sites load, an invoice sends and arrives, a MailerLite test
      sends, Craig's iPad still gets mail
- [ ] Then flipbikes, which also moves the site itself
- [ ] Run `dns-check.py` again and compare

No TTL pre-drop is possible — that needs the HostPapa dashboard. Verify before
switching, not after.

### 3. Switch on the Flipbikes contact form
- [ ] Add the three Resend records to the flipbikes zone
- [ ] Confirm in Resend, wait for verification
- [ ] Create a **sending-only** API key **scoped to flipbikes.co.nz** — not
      full access, not unscoped
- [ ] Add as `RESEND_API_KEY` to the flipbikes-site Vercel project, Production,
      Sensitive. The project currently has no environment variables at all.
- [ ] **Redeploy.** Setting the variable alone changes nothing.
- [ ] Submit a test enquiry and confirm it appears in Resend's logs

### 4. Move the mailboxes to Fastmail
- [ ] Two mailboxes: `craig@betterservice.co.nz` and `sales@flipbikes.co.nz`.
      Both are real accounts on Apple Mail on Craig's iPad, not forwarders.
- [ ] Set up Fastmail Business, both domains, two users (~US$120/yr)
- [ ] **Import the existing mail over IMAP while the HostPapa mailboxes are
      still alive.** Needs Craig's two mailbox passwords, which are in his iPad.
      Once HostPapa is cancelled, whatever is in there is gone.
- [ ] Switch MX, rewrite SPF, add Fastmail DKIM — all together, as one change
- [ ] Repoint Craig's iPad
- [ ] Watch mail arrive at Fastmail for several days before going further

### 5. Cancel HostPapa
- [ ] Craig does this through support, same route as the codes
- [ ] Only after mail has been arriving at Fastmail for several days and both
      sites have been serving from Vercel

## Not part of the migration, but found along the way

- [ ] Send Craig the 13 recovered enquiries (draft is written and waiting)
- [ ] Two of nine customers could not work out how to buy. Worth its own look.
- [ ] Every Flipbikes page carries a Google Analytics tag and a Meta Pixel from
      the original Webflow build. Check Craig can actually see that data, or
      they are liability with no upside.
