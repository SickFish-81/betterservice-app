"use client";

// Betterservice — Parts Requests queue (Phase 3g). The team's job-card requests
// land here; known & common parts can be drafted into a job-tagged PO in one click.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const poNo = (n) => "PO-" + String(n ?? 0).padStart(5, "0");
const STATUS = {
  Requested: "bg-amber-50 text-amber-700",
  Ordered: "bg-blue-50 text-blue-700",
};

export default function PartRequestsPage() {
  const [reqs, setReqs] = useState([]);
  const [counts, setCounts] = useState({});
  const [suppliers, setSuppliers] = useState({});
  const [poNumbers, setPoNumbers] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    const { data: rq, error: e } = await supabase
      .from("part_requests")
      .select("*, parts(name, supplier_id), job_cards(job_number, customers(name))")
      .in("status", ["Requested", "Ordered"])
      .order("created_at", { ascending: true });
    if (e) { setError(e.message); setLoading(false); return; }
    setReqs(rq || []);

    // how many times each part has appeared on a PO — used to spot "common" parts
    const { data: poi } = await supabase.from("purchase_order_items").select("part_id");
    const c = {}; (poi || []).forEach((x) => { if (x.part_id) c[x.part_id] = (c[x.part_id] || 0) + 1; });
    setCounts(c);

    const { data: sup } = await supabase.from("suppliers").select("id, name");
    const sm = {}; (sup || []).forEach((s) => { sm[s.id] = s.name; }); setSuppliers(sm);

    const poIds = [...new Set((rq || []).map((r) => r.po_id).filter(Boolean))];
    if (poIds.length) {
      const { data: pos } = await supabase.from("purchase_orders").select("id, po_number").in("id", poIds);
      const pm = {}; (pos || []).forEach((p) => { pm[p.id] = p.po_number; }); setPoNumbers(pm);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createPO(r) {
    setBusy(r.id); setError(null);
    const { error } = await supabase.rpc("create_po_from_request", { p_request_id: r.id, p_qty: r.quantity });
    setBusy(null);
    if (error) { setError(error.message); return; }
    load();
  }
  async function setStatus(r, status) {
    const { error } = await supabase.from("part_requests").update({ status }).eq("id", r.id);
    if (error) { setError(error.message); return; }
    load();
  }

  const canQuickPO = (r) => r.status === "Requested" && r.part_id && r.parts?.supplier_id && (counts[r.part_id] || 0) >= 2;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Parts Requests</h1>
      <p className="mt-1 text-zinc-600">Parts the team need ordered for jobs. Known, regularly-ordered parts can be turned into a draft order in one click.</p>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : reqs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">Nothing waiting — the team's requests from job cards show up here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {reqs.map((r) => {
              const quick = canQuickPO(r);
              const supName = r.parts?.supplier_id ? suppliers[r.parts.supplier_id] : null;
              return (
                <li key={r.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-900">{r.description} <span className="font-normal text-zinc-500">×{r.quantity}</span></p>
                      <p className="mt-0.5 text-sm text-zinc-500">
                        <Link href={`/jobs/${r.job_card_id}`} className="text-red-600 hover:underline">Job #{r.job_cards?.job_number}</Link>
                        {r.job_cards?.customers?.name ? " · " + r.job_cards.customers.name : ""}
                        {supName ? " · " + supName : ""}
                      </p>
                      {r.note && <p className="mt-1 text-sm text-zinc-600">{r.note}</p>}
                    </div>
                    <span className={"shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " + (STATUS[r.status] || "bg-zinc-100 text-zinc-600")}>{r.status}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    {r.status === "Ordered" ? (
                      <>
                        <Link href={`/purchase-orders/${r.po_id}`} className="font-medium text-blue-700 hover:underline">View order{r.po_id && poNumbers[r.po_id] ? " " + poNo(poNumbers[r.po_id]) : ""}</Link>
                        <button onClick={() => setStatus(r, "Done")} className="text-zinc-600 hover:underline">mark done</button>
                      </>
                    ) : quick ? (
                      <>
                        <button onClick={() => createPO(r)} disabled={busy === r.id} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy === r.id ? "Creating…" : "Create purchase order"}</button>
                        <span className="text-xs text-emerald-600">known · ordered {counts[r.part_id]}× before</span>
                        <button onClick={() => setStatus(r, "Cancelled")} className="ml-auto text-zinc-400 hover:text-red-600">cancel</button>
                      </>
                    ) : (
                      <>
                        <Link href="/purchase-orders" className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">Order manually</Link>
                        <span className="text-xs text-zinc-400">{r.part_id ? (r.parts?.supplier_id ? "new to ordering" : "no supplier set") : "not in inventory"}</span>
                        <button onClick={() => setStatus(r, "Cancelled")} className="ml-auto text-zinc-400 hover:text-red-600">cancel</button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
