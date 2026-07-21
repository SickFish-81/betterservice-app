"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useOwner } from "../RoleContext";

const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString();

const cards = [
  { href: "/jobs", title: "Job Cards", desc: "Take a job from first contact to a filed invoice." },
  { href: "/counter-sales", title: "Counter Sale", desc: "Sell parts & accessories over the counter, no job card.", ownerOnly: true },
  { href: "/invoices", title: "Invoices", desc: "What's billed and what's still owing.", ownerOnly: true },
  { href: "/bills", title: "Bills To Pay", desc: "Supplier bills owing — record payments.", badge: "bills", ownerOnly: true },
  { href: "/part-requests", title: "Parts Requests", desc: "Parts the team need ordered for jobs.", badge: "reqs", ownerOnly: true },
  { href: "/due", title: "Due For Service", desc: "Machines overdue for a service — chase them to book work." },
  { href: "/parts", title: "Parts & Inventory", desc: "Stock levels and low-stock alerts." },
  { href: "/secondhand", title: "For Sale (manage)", desc: "Add & manage second-hand listings + photos.", ownerOnly: true },
  { href: "/customers", title: "Customers", desc: "The people the shop serves." },
  { href: "/machines", title: "Machines", desc: "Bikes & ATVs, linked to their owner." },
  { href: "/timesheets", title: "Timesheets", desc: "Hours worked per person, by week or month.", ownerOnly: true },
  { href: "/staff", title: "Staff", desc: "Who works on jobs, and who can send invoices.", ownerOnly: true },
  { href: "/templates", title: "Checklist Templates", desc: "Standard task lists to drop onto a job." },
  { href: "/settings", title: "Shop Settings", desc: "Business details, GST # & bank shown on invoices.", ownerOnly: true },
];

export default function Dashboard() {
  const [att, setAtt] = useState(null);
  const owner = useOwner();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("attention_summary");
      if (data && data.length) setAtt(data[0]);
    })();
  }, []);

  const badgeFor = (b) => {
    if (!att) return 0;
    if (b === "reqs") return att.parts_requests || 0;
    if (b === "bills") return att.bills_count || 0;
    return 0;
  };
  const descFor = (c) => {
    if (c.badge === "bills" && att && att.bills_count > 0) return `${money(att.bills_total)} owing to suppliers.`;
    return c.desc;
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <img src="/logo.png" alt="Betterservice Te Puke" className="mb-4 h-16 w-auto" />
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Shop Dashboard</h1>
      <p className="mt-2 text-zinc-600">Betterservice Te Puke — back office.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards.filter((c) => !c.ownerOnly || owner).map((c) => {
          const n = c.badge ? badgeFor(c.badge) : 0;
          return (
            <Link key={c.href} href={c.href} className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-red-300 hover:shadow-md">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-zinc-900">
                  {c.title}
                  {n > 0 && <span className="ml-2 inline-block rounded-full bg-red-600 px-2 py-0.5 align-middle text-xs font-bold text-white">{n}</span>}
                </h2>
                <span className="text-red-600 transition group-hover:translate-x-0.5">→</span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">{descFor(c)}</p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
