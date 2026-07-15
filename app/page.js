import Link from "next/link";

const LOGO = "/logo.png";
const HERO = "/hero.jpg";
const ATV = "/atv.jpg";
const SHOP = [
  "/workshop-1.jpg",
  "/workshop-2.jpg",
  "/workshop-3.jpg",
];

function Svg({ children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">{children}</svg>
  );
}

const services = [
  { title: "Servicing & repairs", desc: "Motorcycles and ATVs — routine services through to diagnostics and repairs, done properly.", icon: <Svg><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></Svg> },
  { title: "Used ATV sales", desc: "Quality-checked used ATVs, safe and work-ready. MTF finance arranged and trades welcome.", icon: <Svg><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r="1.2" /></Svg> },
  { title: "Parts & accessories", desc: "Neuton power batteries, Flip recessed bike mounts, and gear to keep you riding.", icon: <Svg><path d="m7.5 4.3 9 5.14" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></Svg> },
  { title: "Honest advice", desc: "25+ years in off-road bikes and ATVs — straight-up advice and a fair price.", icon: <Svg><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></Svg> },
];

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url('${HERO}')` }} />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-zinc-950/92 via-zinc-950/75 to-zinc-900/45" />
        <div className="mx-auto max-w-5xl px-4 py-24 sm:py-32">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400">Te Puke · 25+ years</p>
          <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">Honest, Reliable ATV &amp; Motorcycle Service</h1>
          <p className="mt-4 max-w-xl text-lg text-zinc-200">Servicing, Repairs and Quality Used ATVs from Craig at Betterservice Te Puke. Better Price, Better Advice, Better Bikes.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="tel:02108327787" className="rounded-lg bg-red-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-red-700">Call or text · 021 08327787</a>
            <Link href="/for-sale" className="rounded-lg border border-white/40 bg-white/5 px-5 py-3 font-semibold text-white backdrop-blur hover:bg-white/15">View used ATVs →</Link>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">What we do</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <div key={s.title} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">{s.icon}</div>
              <h3 className="mt-3 text-lg font-semibold text-zinc-900">{s.title}</h3>
              <p className="mt-1 text-sm text-zinc-600">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workshop strip */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">In the workshop</h2>
        <p className="mt-1 text-zinc-600">Fully equipped with the latest test and repair gear — your bike&apos;s in good hands.</p>
        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          {SHOP.map((src, i) => (
            <img key={i} src={src} alt="Betterservice workshop" className="h-28 w-full rounded-lg object-cover sm:h-48" />
          ))}
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="border-t border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-5xl items-center gap-6 px-4 py-12 sm:grid-cols-[auto,1fr]">
          <img src={LOGO} alt="Betterservice Tepuke" className="h-24 w-auto" />
          <div>
            <p className="text-zinc-700">556 Te Puke Highway, Te Puke</p>
            <p className="text-zinc-700">Phone / text: <a href="tel:02108327787" className="font-medium text-red-600 hover:underline">021 08327787</a></p>
            <a href="https://maps.google.com/?q=556+Te+Puke+Highway+Te+Puke" target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-medium text-red-600 hover:underline">Get directions →</a>
            <p className="mt-3 text-sm text-zinc-500">Off-road motorcycle &amp; ATV specialists — servicing, repairs, used ATV sales, parts &amp; accessories.</p>
          </div>
        </div>
        <div className="border-t border-zinc-100 py-6 text-center text-xs text-zinc-500">© Betterservice Tepuke</div>
      </section>
    </main>
  );
}
