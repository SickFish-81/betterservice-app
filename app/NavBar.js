"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const links = [
  { href: "/jobs", label: "Job cards" },
  { href: "/invoices", label: "Invoices" },
  { href: "/credit-notes", label: "Credit notes" },
  { href: "/accounting", label: "Accounting" },
  { href: "/due", label: "Due" },
  { href: "/parts", label: "Parts" },
  { href: "/customers", label: "Customers" },
  { href: "/machines", label: "Machines" },
  { href: "/secondhand", label: "For sale" },
  { href: "/staff", label: "Staff" },
  { href: "/settings", label: "Settings" },
];

export default function NavBar({ email }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const cls = (href) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return active
      ? "rounded-md bg-red-50 px-3 py-1.5 font-semibold text-red-700"
      : "rounded-md px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900";
  };

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
          <span className="inline-block h-5 w-5 rounded bg-red-600" />
          Betterservice
        </Link>

        {/* Desktop links */}
        <nav className="hidden flex-wrap gap-1 text-sm sm:flex">
          {links.map((l) => (<Link key={l.href} href={l.href} className={cls(l.href)}>{l.label}</Link>))}
        </nav>

        {/* Desktop right cluster */}
        <div className="ml-auto hidden items-center gap-2 text-sm sm:flex">
          <Link href="/" className="text-zinc-500 hover:text-zinc-700">View site ↗</Link>
          <button onClick={() => supabase.auth.signOut()} className="rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50">Sign out</button>
        </div>

        {/* Mobile menu toggle */}
        <button onClick={() => setOpen((o) => !o)} aria-label="Menu" className="ml-auto rounded-md p-2 text-zinc-700 hover:bg-zinc-100 sm:hidden">
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <nav className="mx-auto flex max-w-3xl flex-col gap-1 border-t border-zinc-100 px-4 py-2 text-sm sm:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={cls(l.href)}>{l.label}</Link>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-2">
            {email && <span className="truncate text-xs text-zinc-500">{email}</span>}
            <div className="flex shrink-0 items-center gap-3">
              <Link href="/" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-800">View site ↗</Link>
              <button onClick={() => { setOpen(false); supabase.auth.signOut(); }} className="font-medium text-red-600 hover:text-red-700">Sign out</button>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
