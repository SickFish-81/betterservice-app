// FLIP recessed bike mounts.
//
// This page is deliberately NOT in the public nav. It exists because
// /FLIP-recessed-bike-mounts.php has been indexed on the old site for years and
// carries real search ranking; the old URL 308s here, so that ranking lands on
// content instead of a 404. Unlinked is not the same as hidden — it is fully
// indexable on purpose, because losing the ranking is the one outcome the page
// exists to prevent. Do not add a noindex tag, and do not disallow it in
// robots.js. Linking it from the nav later is fine, if Craig wants it visible.
//
// No prices on this page, ever. Ben's rule: figures are not shown to the
// public on a Betterservice page. The shop at flipbikes.co.nz is where
// pricing lives, which also means it can never go stale here.
//
// It is a FEEDER page. Craig sells FLIP from his own shop at flipbikes.co.nz,
// so every buy action here points there rather than duplicating the checkout.
// Do NOT set a cross-domain canonical to flipbikes.co.nz — that would drop this
// page out of search results entirely and throw away the ranking above. The two
// sites stay distinct by having different content, and the outbound links are
// plain follow links so the authority flows on to the shop.
//
// Photography is Craig's own, from flipbikes.co.nz. The originals carry a
// grunge torn-edge border baked into the file; the copies in public/ are
// cropped inside it so they sit flat on a white page.

import Link from "next/link";

const SHOP = "https://flipbikes.co.nz/";

import { pageMeta } from "../../lib/seo";

export const metadata = pageMeta({
  title: "FLIP recessed bike mounts — NZ-made trailer wheel chocks",
  description:
    "FLIP recessed bike mounts: heavy-duty NZ-made aluminium trailer wheel chocks that fold flat into the floor and pivot up to lock the front wheel. From the original designer, Te Puke.",
  path: "/flip-recessed-bike-mounts",
  image: { url: "/flip-hero.webp", width: 1600, height: 900, alt: "A dirt bike front wheel held in an open FLIP recessed chock" },
});

const PRODUCTS = [
  {
    name: "Starter Pack",
    img: "/flip-starter-pack.webp",
    alt: "FLIP starter pack — one standard bike chock, two D rings and two tie downs",
    blurb: "One standard chock, two recessed D rings and two tie downs. Everything you need for one bike.",
  },
  {
    name: "FLIP G3",
    img: "/flip-g3.webp",
    alt: "FLIP G3 recessed bike chock, folded flat",
    blurb: "The third-generation chock — the one most riders end up with.",
  },
  {
    name: "FLIP Standard",
    img: "/flip-standard.webp",
    alt: "FLIP Standard recessed bike chock, folded flat",
    blurb: "The original recessed chock. Straightforward and proven.",
  },
  {
    name: "FLIP Road Bike",
    img: "/flip-g3.webp",
    alt: "FLIP Road Bike recessed chock",
    blurb: "Sized for road bikes, right up to a full-dress Harley.",
  },
];

const FEATURES = [
  ["NZ-made & tough", "Heavy-duty aluminium, made in New Zealand. It won't rust, and in our opinion it'll outlast the trailer."],
  ["Folds flat", "Sits flush in the trailer floor when it isn't holding a bike, so the trailer stays a usable flat-bed."],
  ["Pivots & locks", "Flips up to a locked position that cradles the front wheel so it can't move or turn."],
  ["Easy to fit & use", "Cut it in once and it's done — no bolting and unbolting attachments every trip."],
];

export default function FlipMounts() {
  return (
    <main>
      <section className="bg-zinc-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 lg:grid-cols-2 lg:items-center lg:py-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-red-400">Made in NZ</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">FLIP recessed bike mounts</h1>
            <p className="mt-4 text-lg text-zinc-300">
              The genuine recessed trailer bike wheel chock &amp; holder — straight from the original designer,
              here in Te Puke. Heavy-duty NZ-made aluminium that folds flat when you don&apos;t need it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={SHOP} className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">
                Shop FLIP at flipbikes.co.nz
              </a>
              <a href="tel:02108327787" className="rounded-lg border border-zinc-600 px-5 py-3 font-semibold text-white hover:bg-zinc-800">
                Call or text · 021 08327787
              </a>
            </div>
          </div>
          <img
            src="/flip-hero.webp"
            alt="A dirt bike front wheel held upright in an open FLIP recessed chock on a flat-bed trailer"
            width={1600}
            height={900}
            className="aspect-[16/9] w-full rounded-xl object-cover shadow-lg"
          />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pt-14">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
          Keep your trailer a flat-bed — until you need the chock
        </h2>
        <p className="mt-3 text-zinc-700">
          Ever wanted to keep your MX trailer as a flat bed, but still hold your front wheel so it can&apos;t move
          or turn? That&apos;s exactly what FLIP does. The chocks fold flat into the floor when they aren&apos;t in
          use, then pivot open to a locked position your front wheel drops straight into. Fit two or three and one
          trailer carries the whole shed.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-zinc-900">{t}</h3>
              <p className="mt-1 text-sm text-zinc-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pt-10">
        <div className="grid gap-4 sm:grid-cols-2">
          <figure>
            <img
              src="/flip-open.webp"
              alt="A FLIP chock pivoted open out of its recessed tray in a trailer floor"
              width={1200}
              height={800}
              loading="lazy"
              className="aspect-[3/2] w-full rounded-xl object-cover shadow-sm"
            />
            <figcaption className="mt-2 text-sm text-zinc-600">
              Flipped up and locked. Flat in the floor when it isn&apos;t.
            </figcaption>
          </figure>
          <figure>
            <img
              src="/flip-install.webp"
              alt="Cutting a recess into a trailer floor to fit a FLIP chock"
              width={1200}
              height={800}
              loading="lazy"
              className="aspect-[3/2] w-full rounded-xl object-cover shadow-sm"
            />
            <figcaption className="mt-2 text-sm text-zinc-600">
              Cut the recess once and it&apos;s in for good.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 pt-14">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">The range</h2>
        <p className="mt-2 text-zinc-700">
          FLIP is sold from its own shop. Pick your unit there and it ships from Te Puke.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCTS.map((p) => (
            <a
              key={p.name}
              href={SHOP}
              className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-red-300 hover:shadow-md"
            >
              <img
                src={p.img}
                alt={p.alt}
                width={840}
                height={1050}
                loading="lazy"
                className="aspect-[4/5] w-full rounded-lg bg-white object-contain"
              />
              <h3 className="mt-3 font-semibold text-zinc-900">{p.name}</h3>
              <p className="mt-1 flex-1 text-sm text-zinc-600">{p.blurb}</p>
              <p className="mt-3 text-sm font-semibold text-red-600 group-hover:underline">See it at flipbikes.co.nz →</p>
            </a>
          ))}
        </div>
        <p className="mt-4 text-sm text-zinc-500">
          Also available: heavy-duty recessed D rings and tie downs. Current pricing and shipping are on
          flipbikes.co.nz.
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <div className="rounded-xl border border-red-100 bg-red-50 p-6 text-center">
          <p className="text-lg font-semibold text-zinc-900">Want a set?</p>
          <p className="mt-1 text-sm text-zinc-700">
            Order online at{" "}
            <a href={SHOP} className="font-semibold text-red-700 hover:underline">
              flipbikes.co.nz
            </a>
            , or call or text Craig on{" "}
            <a href="tel:02108327787" className="font-semibold text-red-700 hover:underline">
              021 08327787
            </a>
            .
          </p>
          <p className="mt-2 text-sm text-zinc-700">
            Trailer manufacturers and wholesale — talk to Craig directly.
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            <Link href="/" className="hover:underline">
              ← Betterservice Tepuke
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
