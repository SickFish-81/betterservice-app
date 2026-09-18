"use client";

// The shop dashboard.
//
// It used to be sixteen large cards, each with a sentence explaining what it
// was. Those sentences were read once in August and then scrolled past every
// day since — they made up most of the height, and on a phone the whole thing
// was one long column where nothing stood out. Craig opens this more than any
// other screen, usually on a phone, usually mid-job.
//
// So it is now: what needs doing first, then everything else in three short
// groups. Nothing was removed — every page that was reachable still is, with
// the same owner-only rules.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useOwner } from "../RoleContext";
import PushSetup from "../PushSetup";

const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString();

// Every destination, grouped the way the work actually splits. `ownerOnly` is
// carried through untouched from the old list — this is a layout change, not a
// permissions one.
const GROUPS = [
  {
    name: "Workshop",
    items: [
      { href: "/jobs", title: "Job Cards", primary: true },
      { href: "/search", title: "Search" },
      { href: "/parts", title: "Parts & Inventory", badge: "low_stock" },
      { href: "/due", title: "Due For Service", badge: "service_due" },
      { href: "/machines", title: "Machines" },
      { href: "/templates", title: "Checklist Templates" },
    ],
  },
  {
    name: "Money",
    items: [
      { href: "/invoices", title: "Invoices", badge: "unsent", ownerOnly: true },
      { href: "/counter-sales", title: "Counter Sale", ownerOnly: true },
      { href: "/bills", title: "Bills To Pay", badge: "bills", ownerOnly: true },
      { href: "/timesheets", title: "Timesheets", ownerOnly: true },
    ],
  },
  {
    name: "Shop & admin",
    items: [
      { href: "/customers", title: "Customers" },
      { href: "/bookings", title: "Booking Requests", badge: "bookings", ownerOnly: true },
      { href: "/rentals", title: "Rentals", badge: "rent", ownerOnly: true },
      { href: "/secondhand", title: "For Sale", ownerOnly: true },
      { href: "/staff", title: "Staff", ownerOnly: true },
      { href: "/settings", title: "Shop Settings", ownerOnly: true },
    ],
  },
];

export default function Dashboard() {
  const [att, setAtt] = useState(null);
  // Two things the database summary doesn't carry: invoices raised and never
  // sent, and what the unpaid ones come to. Both are money questions, so both
  // are owner-only.
  const [unsent, setUnsent] = useState(0);
  const [unpaidTotal, setUnpaidTotal] = useState(0);
  const [rentWaiting, setRentWaiting] = useState(0);
  const owner = useOwner();
  const router = useRouter();

  // Clear the stored session, then send them to the sign-in page.
  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("attention_summary");
      if (data && data.length) setAtt(data[0]);
    })();
  }, []);

  useEffect(() => {
    if (!owner) return;
    (async () => {
      const [uns, unpaid, rent] = await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("kind", "atv").eq("sent", false),
        supabase.from("invoices").select("total").eq("sent", true).not("status", "in", "(Paid,Credited)"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("kind", "rental").eq("sent", false),
      ]);
      setUnsent(uns.count || 0);
      setUnpaidTotal((unpaid.data || []).reduce((s, r) => s + Number(r.total || 0), 0));
      setRentWaiting(rent.count || 0);
    })();
  }, [owner]);

  const counts = {
    low_stock: att?.low_stock || 0,
    service_due: att?.service_due || 0,
    bills: att?.bills_count || 0,
    bookings: att?.bookings_new || 0,
    unsent: owner ? unsent : 0,
    rent: owner ? rentWaiting : 0,
  };

  // What needs doing, worst first. Anything at zero is left out entirely rather
  // than shown as a zero — a row of noughts is just something else to read past.
  const attention = [
    counts.unsent && { href: "/invoices", n: counts.unsent, text: `Invoice${counts.unsent === 1 ? "" : "s"} raised but not sent`, meta: "not with the customer yet" },
    att?.jobs_ready && { href: "/jobs", n: att.jobs_ready, text: `Job${att.jobs_ready === 1 ? "" : "s"} ready to invoice` },
    counts.rent && { href: "/rentals", n: counts.rent, text: `Rent invoice${counts.rent === 1 ? "" : "s"} awaiting approval` },
    counts.bookings && { href: "/bookings", n: counts.bookings, text: `New booking request${counts.bookings === 1 ? "" : "s"}` },
    owner && att?.invoices_unpaid && { href: "/invoices", n: att.invoices_unpaid, text: `Invoice${att.invoices_unpaid === 1 ? "" : "s"} unpaid`, meta: unpaidTotal ? `${money(unpaidTotal)} owing` : null },
    counts.bills && { href: "/bills", n: counts.bills, text: `Bill${counts.bills === 1 ? "" : "s"} to pay`, meta: att?.bills_total ? `${money(att.bills_total)} owing` : null },
    counts.low_stock && { href: "/parts", n: counts.low_stock, text: `Part${counts.low_stock === 1 ? "" : "s"} low on stock` },
    counts.service_due && { href: "/due", n: counts.service_due, text: `Machine${counts.service_due === 1 ? "" : "s"} due for a service` },
  ].filter(Boolean);

  const tile =
    "flex min-h-[48px] items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-3 " +
    "text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-red-300 hover:shadow";

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="Betterservice ATV" className="h-11 w-auto shrink-0 sm:h-14" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">Shop Dashboard</h1>
          <p className="text-xs text-zinc-500">Betterservice ATV — back office</p>
        </div>
        <button onClick={signOut} className="ml-auto shrink-0 rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50">
          Sign out
        </button>
      </div>

      {attention.length > 0 && (
        <div className="mt-5 rounded-xl border border-zinc-200 border-l-[3px] border-l-red-600 bg-white p-3 shadow-sm">
          <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-red-800">Needs attention</h2>
          <ul>
            {attention.map((a, i) => (
              <li key={a.href + a.text}>
                <Link
                  href={a.href}
                  className={`flex items-baseline gap-2 py-1.5 ${i > 0 ? "border-t border-zinc-100" : ""}`}
                >
                  <span className="min-w-[20px] text-[15px] font-extrabold text-red-600">{a.n}</span>
                  <span className="text-sm text-zinc-800">{a.text}</span>
                  {a.meta && <span className="ml-auto whitespace-nowrap text-xs text-zinc-500">{a.meta}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {GROUPS.map((g) => {
        const items = g.items.filter((it) => !it.ownerOnly || owner);
        // A group with nothing in it for this person doesn't get a heading.
        if (items.length === 0) return null;
        return (
          <section key={g.name} className="mt-5">
            <p className="mb-1.5 ml-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">{g.name}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.map((it) => {
                const n = it.badge ? counts[it.badge] || 0 : 0;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={it.primary ? `${tile} !border-zinc-900 !bg-zinc-900 !text-white hover:!border-zinc-700` : tile}
                  >
                    {it.title}
                    {n > 0 && (
                      <span className="ml-auto rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">{n}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Per device, not per person — and the one thing that has to be done on
          each phone before a pick-up can buzz it. */}
      <div className="mt-6">
        <PushSetup />
      </div>
    </main>
  );
}
