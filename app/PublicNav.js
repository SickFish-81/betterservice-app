"use client";

import Link from "next/link";

const LOGO = "/logo-badge.png";

export default function PublicNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <Link href="/" className="flex items-center">
          <img src={LOGO} alt="Betterservice ATV" className="h-11 w-auto" />
          <span className="sr-only">Betterservice ATV</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm font-medium text-zinc-600">
          <Link href="/for-sale" className="hover:text-zinc-900">Used ATVs</Link>
          <Link href="/batteries" className="hover:text-zinc-900">Batteries</Link>
          <Link href="/book" className="hover:text-zinc-900">Book a service</Link>
          <a href="https://flipbikes.co.nz" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Flip Bikes</a>
          <a href="https://snapd.nz/" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-900">Snap-D Shackles</a>
        </nav>
        <div className="ml-auto">
          <Link href="/dashboard" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Staff login</Link>
        </div>
      </div>
    </header>
  );
}
