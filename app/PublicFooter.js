"use client";

// Footer on every public page. "Contact" is deliberately an ENQUIRY, not a
// booking: someone asking a question hasn't committed a machine to the workshop,
// and the two shouldn't arrive looking the same.

import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="text-zinc-600">
          <p className="font-semibold text-zinc-900">Betterservice ATV</p>
          <p className="mt-1">556 Te Puke Highway, Te Puke</p>
          <p className="mt-0.5">
            Phone or text <a href="tel:+642108327787" className="font-medium text-zinc-800 hover:underline">021 08327787</a>
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-zinc-600">
          <Link href="/enquiry" className="font-medium text-zinc-800 hover:text-red-700 hover:underline">Contact — make an enquiry</Link>
          <Link href="/book" className="hover:text-zinc-900 hover:underline">Book a service</Link>
          <Link href="/for-sale" className="hover:text-zinc-900 hover:underline">Used ATVs</Link>
          <Link href="/batteries" className="hover:text-zinc-900 hover:underline">Batteries</Link>
        </nav>
      </div>
      <div className="border-t border-zinc-100">
        <p className="mx-auto max-w-5xl px-4 py-3 text-xs text-zinc-400">© Betterservice ATV</p>
      </div>
    </footer>
  );
}
