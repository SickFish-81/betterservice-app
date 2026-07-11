import Link from "next/link";

const PRODUCT_IMG = "/battery.jpg";

const categories = [
  {
    title: "ATV · SxS · UTV · Motorcycle",
    items: [
      "Honda ATV — TRX300 / 350 / 400 / 450 / 500 (YTX14-BS, 14Ah 12V AGM)",
      "Suzuki KingQuad — LTF300, LTA500, LTA750",
      "Yamaha — YFM350, YFA350, Grizzly 550",
      "Yamaha SxS — Wolverine, Viking, Rhino",
      "Kawasaki Teryx 800 SxS",
      "Honda Pioneer 700 / 1000 & Can-Am Talon (YTX20L-BS AGM)",
      "Polaris ATV",
      "Lithium options available",
    ],
  },
  {
    title: "Ride-on & Lawn Mowers",
    items: ["Kubota, Husqvarna, Walker, Bobcat, MTD, John Deere and more — AGM & lithium, all types."],
  },
  {
    title: "Car · 4x4 · Commercial · Tractor",
    items: ["A full range of AGM and standard batteries for cars, 4x4s, utes, commercial vehicles and tractors."],
  },
  {
    title: "Marine & Boat",
    items: ["Starting and deep-cycle batteries for boats and marine use."],
  },
];

export default function Batteries() {
  return (
    <main>
      <section className="bg-zinc-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400">In stock now</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Neuton Power Batteries</h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-300">Cheap, quality AGM &amp; lithium batteries — ATVs, side-by-sides, motorcycles, mowers, cars, 4x4s, tractors and marine. Ready to go at Betterservice Tepuke.</p>
          <a href="tel:02108327787" className="mt-7 inline-block rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">Call or text · 021 08327787</a>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
            {categories.map((c) => (
              <div key={c.title} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-900">{c.title}</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-zinc-600">
                  {c.items.map((it, i) => (
                    <li key={i} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" /><span>{it}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div>
            <img src={PRODUCT_IMG} alt="Neuton Power Batteries" className="w-full rounded-xl border border-zinc-200 bg-white object-contain" />
            <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-5">
              <p className="font-semibold text-zinc-900">Not sure which one?</p>
              <p className="mt-1 text-sm text-zinc-700">Tell Craig your make and model and he'll sort the right battery — most are in stock and ready to fit.</p>
              <a href="tel:02108327787" className="mt-3 inline-block rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">Call or text Craig</a>
            </div>
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-zinc-500">Can't see your machine? We stock loads more — just ask. <Link href="/for-sale" className="font-medium text-red-600 hover:underline">Browse used ATVs →</Link></p>
      </section>
    </main>
  );
}
