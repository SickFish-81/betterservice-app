#!/usr/bin/env python3
"""
Checks that betterservice.co.nz and flipbikes.co.nz are serving what they
should be. Run it BEFORE the nameserver change to capture a baseline, and
again AFTER, and compare. Nothing here changes anything.

    python3 dns-check.py            # check against expectations below
    python3 dns-check.py --raw      # dump every record, no judgement

Expectations live in EXPECTED. When a record deliberately changes (mail moving
to Fastmail, flipbikes moving to Vercel), update it HERE in the same commit as
the change, so the file always says what "correct" means today rather than
what it meant last month.

Resolution goes over DNS-over-HTTPS to Cloudflare's resolver rather than the
local one, so it sees what the public internet sees and not a stale cache on
whatever machine this runs on.
"""
import json, sys, urllib.request, urllib.error, concurrent.futures

DOH = "https://cloudflare-dns.com/dns-query"

# substring match, not exact: DKIM keys are enormous and TXT records get
# quoted and split by resolvers in ways that are not worth fighting
EXPECTED = {
    "betterservice.co.nz": [
        ("A",   "",                   "216.150.1.1",                   "website (Vercel)"),
        ("A",   "www",                "216.150.1.1",                   "website (Vercel)"),
        ("MX",  "",                   "us1-smtp.messagingengine.com",  "MAIL - Fastmail, primary (pri 10)"),
        ("MX",  "",                   "us2-smtp.messagingengine.com",  "MAIL - Fastmail, secondary (pri 20)"),
        ("MX",  "",                   "hostedemail.com",               "MAIL - HostPapa fallback at pri 30; GOES when HostPapa is cancelled"),
        ("TXT", "",                   "include:spf.messagingengine.com","SPF - Fastmail authorised to send"),
        ("TXT", "",                   "include:_spf.mlsend.com",       "SPF - MailerLite; deleting this silently kills Craig's newsletters"),
        ("TXT", "",                   "v=spf1",                        "SPF - the one that quietly breaks invoices"),
        ("CNAME","fm1._domainkey",    "dkim.fmhosted.com",             "Fastmail DKIM 1 of 3"),
        ("CNAME","fm2._domainkey",    "dkim.fmhosted.com",             "Fastmail DKIM 2 of 3"),
        ("CNAME","fm3._domainkey",    "dkim.fmhosted.com",             "Fastmail DKIM 3 of 3"),
        ("TXT", "",                   "mailerlite-domain-verification","MailerLite ownership"),
        ("TXT", "_dmarc",             "v=DMARC1",                      "DMARC policy"),
        ("TXT", "resend._domainkey",  "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN","Resend DKIM - signs every invoice"),
        ("MX",  "send",               "amazonses.com",                 "Resend bounce handling"),
        ("TXT", "send",               "include:amazonses.com",         "Resend sending authority"),
        ("TXT", "litesrv._domainkey", "v=DKIM1",                       "MailerLite DKIM"),
    ],
    "flipbikes.co.nz": [
        ("A",   "",    "",                 "website - still HostPapa (301 to www); becomes Vercel at the DNS move"),
        ("CNAME","www", "vercel-dns",      "website - Vercel"),
        ("MX",  "",    "us1-smtp.messagingengine.com", "MAIL - Fastmail, primary (pri 10)"),
        ("MX",  "",    "us2-smtp.messagingengine.com", "MAIL - Fastmail, secondary (pri 20)"),
        ("TXT", "",    "include:spf.messagingengine.com", "SPF - Fastmail authorised to send"),
        ("TXT", "",    "v=spf1",           "SPF"),
        ("CNAME","fm1._domainkey", "dkim.fmhosted.com", "Fastmail DKIM 1 of 3"),
        ("CNAME","fm2._domainkey", "dkim.fmhosted.com", "Fastmail DKIM 2 of 3"),
        ("CNAME","fm3._domainkey", "dkim.fmhosted.com", "Fastmail DKIM 3 of 3"),
        ("TXT", "resend._domainkey", "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN", "Resend DKIM - signs contact-form mail"),
    ],
}

SITES = [
    ("https://betterservice.co.nz/",     "Betterservice"),
    ("https://www.betterservice.co.nz/", "Betterservice www"),
    ("https://flipbikes.co.nz/",         "Flip Bikes"),
    ("https://www.flipbikes.co.nz/",       "Flip Bikes www"),
]

def resolve(name, rtype):
    url = f"{DOH}?name={name}&type={rtype}"
    req = urllib.request.Request(url, headers={"accept": "application/dns-json"})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=20))
        return [a.get("data", "") for a in data.get("Answer", [])]
    except Exception as e:
        return [f"!! {e}"]

def fqdn(sub, domain):
    return f"{sub}.{domain}" if sub else domain

def check():
    bad = 0
    for domain, records in EXPECTED.items():
        print(f"\n{domain}")
        print(f"  {'NS':<6} {'':<20} {resolve(domain,'NS')}")
        jobs = {}
        with concurrent.futures.ThreadPoolExecutor(10) as ex:
            for rtype, sub, _, _ in records:
                jobs[(rtype, sub)] = ex.submit(resolve, fqdn(sub, domain), rtype)
        for rtype, sub, expect, why in records:
            got = jobs[(rtype, sub)].result()
            blob = " ".join(got)
            ok = (expect in blob) if expect else bool(got)
            if not ok:
                bad += 1
            mark = "ok  " if ok else "FAIL"
            label = fqdn(sub, domain)
            print(f"  {mark} {rtype:<4} {label:<36} {why}")
            if not ok:
                print(f"       expected to contain: {expect or '(any answer)'}")
                print(f"       got:                 {got or '(nothing)'}")
    return bad

class _KeepRedirects(urllib.request.HTTPRedirectHandler):
    """Report redirects instead of following them.

    urllib follows 301/302/303/307 but raises on 308, which made
    www.betterservice.co.nz -> betterservice.co.nz look like a failure when it
    is the redirect working correctly. A redirect to the right place is a pass;
    we want to SEE it, not silently follow it.
    """
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def check_sites():
    print("\nsites")
    bad = 0
    opener = urllib.request.build_opener(_KeepRedirects)
    for url, label in SITES:
        try:
            req = urllib.request.Request(url, method="GET",
                                         headers={"user-agent": "dns-check"})
            with opener.open(req, timeout=25) as r:
                server = r.headers.get("server", "?")
                if 300 <= r.status < 400:
                    print(f"  ok   {r.status} {label:<24} -> {r.headers.get('location','?')}")
                else:
                    print(f"  ok   {r.status} {label:<24} served by {server}")
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                print(f"  ok   {e.code} {label:<24} -> {e.headers.get('location','?')}")
            else:
                bad += 1
                print(f"  FAIL {e.code} {label:<24} {e}")
        except Exception as e:
            bad += 1
            print(f"  FAIL     {label:<24} {e}")
    return bad

def raw():
    subs = ["", "www", "mail", "webmail", "ftp", "cpanel", "send", "_dmarc",
            "resend._domainkey", "litesrv._domainkey", "default._domainkey",
            "fm1._domainkey", "fm2._domainkey", "fm3._domainkey"]
    for domain in EXPECTED:
        print(f"\n########## {domain} ##########")
        for sub in subs:
            name = fqdn(sub, domain)
            for rtype in ("A", "MX", "TXT", "CNAME", "NS"):
                got = resolve(name, rtype)
                if got:
                    print(f"  {rtype:<6} {name:<40} {got}")

if __name__ == "__main__":
    if "--raw" in sys.argv:
        raw()
        sys.exit(0)
    failures = check() + check_sites()
    print()
    if failures:
        print(f"{failures} problem(s). Compare against DNS-PLAN.md before touching anything.")
        sys.exit(1)
    print("Everything matches what DNS-PLAN.md says it should be.")
