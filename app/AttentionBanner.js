"use client";

// Betterservice — owner "needs attention" banner (Phase 3h). Sits under the nav
// on every back-office page; surfaces the day's action items as clickable chips.
// Driven by the owner-gated attention_summary() RPC.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

const money = (n) => "$" + Math.round(Number(n || 0)).toLocaleString();

export default function AttentionBanner() {
  const [s, setS] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("attention_summary");
      if (data && data.length) setS(data[0]);
    })();
  }, []);

  if (!s) return null;

  const chips = [];
  const plural = (n) => (n > 1 ? "s" : "");
  if (s.parts_requests > 0) chips.push({ href: "/part-requests", label: `${s.parts_requests} part request${plural(s.parts_requests)} waiting`, tone: "red" });
  if (s.bills_count > 0) chips.push({ href: "/bills", label: `${s.bills_count} bill${plural(s.bills_count)} to pay · ${money(s.bills_total)}`, tone: "red" });
  if (s.invoices_unpaid > 0) chips.push({ href: "/invoices", label: `${s.invoices_unpaid} invoice${plural(s.invoices_unpaid)} unpaid`, tone: "amber" });
  if (s.low_stock > 0) chips.push({ href: "/parts", label: `${s.low_stock} part${plural(s.low_stock)} low on stock`, tone: "amber" });
  if (s.service_due > 0) chips.push({ href: "/due", label: `${s.service_due} due for service`, tone: "amber" });

  if (chips.length === 0) return null;

  const toneCls = (t) =>
    t === "red"
      ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
      : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";

  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Needs attention</span>
        {chips.map((c) => (
          <Link key={c.href} href={c.href} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${toneCls(c.tone)}`}>
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
