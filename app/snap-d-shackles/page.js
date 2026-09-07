// Snap-D shackles — a "we stock these, come and get them" page.
//
// The nav used to point straight at snapd.nz, which sent the traffic Craig
// earned to the manufacturer and gave Google nothing to rank for Betterservice.
// This keeps the visit here.
//
// No prices, deliberately: the point is that they're on the shelf today, and a
// price list on a static page is a promise that goes stale without anyone
// noticing. Sizes and ratings aren't listed either — the right shackle depends
// on the load, and that's a conversation, not a table.
//
// The copy is written from what the product is, not lifted from Snap-D's site.
// The credit link at the foot is deliberate: they made it, and saying so is
// both honest and the reason a buyer trusts it.

import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

// Two product photos, shown only if they're actually there.
//
// This page is a server component, so it runs at build time and can simply LOOK
// on disk. That matters: pointing an <img> at a file that hasn't been added yet
// gives every visitor a broken-image icon, which is worse than no photo at all,
// and it happens the moment someone pushes before the pictures land. Checking
// first means the page is correct in both states — drop the files into public/
// and they appear on the next deploy; leave them out and nobody can tell they
// were ever planned.
//
// To add them: put snapd-1.jpg and snapd-2.jpg in public/. Roughly square is
// best — they sit side by side in a narrow strip.
const PHOTOS = [
  { src: "/snapd-1.jpg", alt: "Snap-D stainless shackle" },
  { src: "/snapd-2.jpg", alt: "Snap-D shackle fitted to a trailer coupling" },
].filter((p) => {
  try {
    return fs.existsSync(path.join(process.cwd(), "public", p.src.replace(/^\//, "")));
  } catch {
    return false;   // never let a missing file break the whole page
  }
});

export const metadata = {
  title: "Snap-D shackles",
  description:
    "Snap-D captive-pin shackles in stock at Betterservice ATV, Te Puke. NZ-made stainless D and bow shackles that lock with a half turn — tow rated for caravans, floats, boats and bike trailers.",
  alternates: { canonical: "/snap-d-shackles" },
};

const FEATURES = [
  [
    "Half a turn and it's on",
    "No threading a pin down a hole in the rain, and no dropped pin rolling under the trailer. Half a turn locks it, half a turn releases it.",
  ],
  [
    "The pin stays put",
    "A captive pin, held by a roll pin. It can't be over-tightened, it can't rattle loose on a rough road, and there's no loose part to lose.",
  ],
  [
    "Stainless — it won't seize",
    "Stainless steel, so a boat trailer that lives in salt water still comes apart by hand next season. Galvanised shackles rust into one piece.",
  ],
  [
    "Tow rated and certified",
    "Load tested and certified for towing in New Zealand and Australia, to NZS5467. Every shackle carries its rating — bring the job to Craig and he'll match it.",
  ],
];

const RANGE = [
  ["D shackles", "The standard straight-sided shackle. The usual choice for a trailer coupling or safety chain."],
  ["Bow shackles", "The rounder body takes a load from more than one direction — handy where straps or chains pull off-square."],
  ["Multi packs", "Sets, for when the trailer, the float and the boat all need doing at once."],
  ["Retaining clips", "The spares that go missing first."],
];

const USES = ["Caravans", "Horse floats", "Boat trailers", "Bike & toy-hauler trailers", "Farm trailers"];

export default function SnapDShackles() {
  return (
    <main>
      <section className="bg-zinc-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400">In stock now</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Snap-D shackles</h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-300">
            The NZ-made stainless shackle that locks with a half turn — no fiddly pin, nothing to drop,
            nothing to seize up. On the shelf at Betterservice, 556 Te Puke Highway.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="tel:02108327787" className="inline-block rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">
              Call or text · 021 08327787
            </a>
            <Link href="/enquiry" className="inline-block rounded-lg border border-zinc-600 px-5 py-3 font-semibold text-zinc-200 hover:bg-zinc-800">
              Send an enquiry
            </Link>
          </div>
        </div>
      </section>

      {PHOTOS.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 pt-10">
          <div className="grid gap-4 sm:grid-cols-2">
            {PHOTOS.map((ph) => (
              <img
                key={ph.src}
                src={ph.src}
                alt={ph.alt}
                loading="lazy"
                className="h-56 w-full rounded-xl border border-zinc-200 bg-white object-contain p-3 shadow-sm"
              />
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto max-w-5xl px-4 py-14">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Why they're worth the swap</h2>
        <p className="mt-2 max-w-2xl text-zinc-600">
          Anyone who has knelt in a wet car park trying to line up a shackle pin already knows the problem.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-zinc-900">{t}</h3>
              <p className="mt-1 text-sm text-zinc-600">{d}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-14 text-2xl font-bold tracking-tight text-zinc-900">What we keep on hand</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {RANGE.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-zinc-900">{t}</h3>
              <p className="mt-1 text-sm text-zinc-600">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-zinc-500">
          Sizes and ratings vary — the right shackle depends on what you're towing. Bring the trailer or
          the old shackle in and Craig will match it.
        </p>

        <h2 className="mt-14 text-2xl font-bold tracking-tight text-zinc-900">What people use them on</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {USES.map((u) => (
            <li key={u} className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 shadow-sm">{u}</li>
          ))}
        </ul>

        <div className="mt-12 rounded-xl border border-red-100 bg-red-50 p-6">
          <p className="text-lg font-semibold text-zinc-900">Come and grab a set</p>
          <p className="mt-1 text-zinc-700">
            556 Te Puke Highway, Te Puke. Ring ahead if you want a particular size put aside.
          </p>
          <a href="tel:02108327787" className="mt-4 inline-block rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">
            Call or text Craig · 021 08327787
          </a>
        </div>

        <p className="mt-8 text-center text-sm text-zinc-500">
          Snap-D is designed and made in New Zealand by{" "}
          <a href="https://snapd.nz/" target="_blank" rel="noopener noreferrer" className="font-medium text-red-600 hover:underline">
            Snap-D
          </a>
          . Betterservice is a stockist.
        </p>
      </section>
    </main>
  );
}
