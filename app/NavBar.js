"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

const groups = [
  {
    label: "Accounting",
    items: [
      { href: "/invoices", label: "Invoices" },
      { href: "/credit-notes", label: "Credit Notes" },
      { href: "/bills", label: "Bills" },
      { href: "/expenses", label: "Expenses" },
      { href: "/accounting", label: "Overview" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/parts", label: "Parts" },
      { href: "/stocktake", label: "Stocktake" },
      { href: "/suppliers", label: "Suppliers" },
      { href: "/purchase-orders", label: "Orders" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/customers", label: "Customers" },
      { href: "/machines", label: "Machines" },
      { href: "/due", label: "Due" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/secondhand", label: "For Sale" },
      { href: "/staff", label: "Staff" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export default function NavBar({ email }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile sheet
  const [menu, setMenu] = useState(null);  // open desktop dropdown label

  // Close an open dropdown on any outside click.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);

  // The dashboard is the back-office launcher (its large tiles are the nav there),
  // so hide the top bar on that page only.
  if (pathname === "/dashboard") return null;

  const isActive = (href) => pathname === href || pathname.startsWith(href + "/");
  const groupActive = (g) => g.items.some((i) => isActive(i.href));

  const triggerCls = (active) =>
    "rounded-md px-3 py-1.5 text-sm font-medium " +
    (active ? "bg-red-50 text-red-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900");
  const itemCls = (active) =>
    "block rounded-md px-3 py-2 text-sm " +
    (active ? "bg-red-50 font-semibold text-red-700" : "text-zinc-700 hover:bg-zinc-100");

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
        <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
          <span className="inline-block h-5 w-5 rounded bg-red-600" />
          Betterservice
        </Link>

        {/* Desktop nav */}
        <nav className="ml-2 hidden items-center gap-1 text-sm sm:flex">
          <Link href="/jobs" className={triggerCls(isActive("/jobs"))}>Job Cards</Link>
          {groups.map((g) => (
            <div key={g.label} className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenu(menu === g.label ? null : g.label); }}
                className={triggerCls(groupActive(g) || menu === g.label)}
              >
                {g.label} <span className="text-xs">▾</span>
              </button>
              {menu === g.label && (
                <div onClick={(e) => e.stopPropagation()} className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
                  {g.items.map((i) => (
                    <Link key={i.href} href={i.href} onClick={() => setMenu(null)} className={itemCls(isActive(i.href))}>{i.label}</Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Desktop right cluster */}
        <div className="ml-auto hidden items-center gap-2 text-sm sm:flex">
          <Link href="/" className="text-zinc-500 hover:text-zinc-700">View site ↗</Link>
          <button onClick={() => supabase.auth.signOut()} className="rounded-md px-2 py-1 font-medium text-red-600 hover:bg-red-50">Sign out</button>
        </div>

        {/* Mobile toggle */}
        <button onClick={() => setOpen((o) => !o)} aria-label="Menu" className="ml-auto rounded-md p-2 text-zinc-700 hover:bg-zinc-100 sm:hidden">
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          )}
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <nav className="mx-auto max-w-4xl border-t border-zinc-100 px-4 py-2 text-sm sm:hidden">
          <Link href="/jobs" onClick={() => setOpen(false)} className={itemCls(isActive("/jobs"))}>Job Cards</Link>
          {groups.map((g) => (
            <div key={g.label} className="mt-2">
              <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{g.label}</p>
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={itemCls(isActive(i.href))}>{i.label}</Link>
              ))}
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
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
