// ─────────────────────────────────────────────────────────────────────────────
// DRAFT — NOT LIVE. Kept on ice (Flip has its own site: flipbikes.co.nz).
// To publish later: (1) move this file to app/flip/page.js,
//   (2) add "/flip" to PUBLIC_EXACT in app/AuthGate.js,
//   (3) add <Link href="/flip">Flip mounts</Link> to app/PublicNav.js.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";

export default function Flip() {
  const features = [
    ["NZ-made & tough", "Quality heavy-duty aluminium — very strong and won't rust. In our opinion they'll outlast the trailer."],
    ["Fold flat", "Sit flush in the trailer floor when not in use, so it stays a usable flat-bed."],
    ["Pivot & lock", "Flip up to a locked position that cradles the front wheel so it can't move or turn."],
    ["Easy to fit & use", "Simple to mount and use — no bolting and unbolting attachments each time. Proven on bikes for years."],
  ];
  return (
    <main>
      <section className="bg-zinc-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-400">Made in NZ</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">FLIP recessed bike mounts</h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-300">The genuine recessed trailer bike wheel chock &amp; holder — straight from the original designer. Heavy-duty NZ-made aluminium that folds flat when you don't need it.</p>
          <a href="tel:02108327787" className="mt-7 inline-block rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">Call or text · 021 08327787</a>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">Keep your trailer a flat-bed — until you need the chock</h2>
        <p className="mt-3 text-zinc-700">Ever wanted to keep your MX trailer as a flat bed, but still hold your front wheel so it can't move or turn? That's exactly what FLIP does — the chocks fold flat into the floor when not in use, then pivot open to a locked position your front wheel drops straight into.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {features.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-zinc-900">{t}</h3>
              <p className="mt-1 text-sm text-zinc-600">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <p className="font-semibold text-zinc-900">Want a set?</p>
          <p className="mt-1 text-sm text-zinc-700">Call or text Craig on 021 08327787.</p>
          <p className="mt-2 text-xs text-zinc-500"><Link href="/" className="hover:underline">← Betterservice Tepuke</Link></p>
        </div>
      </section>
    </main>
  );
}
