"use client";

// Betterservice — Purchase orders (Phase 3b): list + create.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const money = (n) => "$" + Number(n || 0).toFixed(2);
const poNo = (n) => "PO-" + String(n ?? 0).padStart(5, "0");
const STATUS_STYLES = {
  Draft: "bg-zinc-100 text-zinc-700",
  Ordered: "bg-amber-50 text-amber-700",
  Received: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-red-50 text-red-600",
};

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [parts, setParts] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState([{ part_id: "", qty: "1", cost: "" }]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("id, po_number, status, order_date, received_date, suppliers(name), purchase_order_items(qty_ordered, unit_cost)")
      .order("po_number", { ascending: false });
    if (error) setError(error.message); else setOrders(data || []);
    const { data: sup } = await supabase.from("suppliers").select("id, name, is_active").order("name");
    setSuppliers((sup || []).filter((s) => s.is_active));
    const { data: pr } = await supabase.from("parts").select("id, name").order("name");
    setParts(pr || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const setLine = (i, k) => (e) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: e.target.value } : l)));
  const addLine = () => setLines((ls) => [...ls, { part_id: "", qty: "1", cost: "" }]);
  const removeLine = (i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const validLines = lines.filter((l) => l.part_id && Number(l.qty) > 0);
  const orderTotal = validLines.reduce((s, l) => s + Number(l.qty) * Number(l.cost || 0), 0);

  async function create(e) {
    e.preventDefault();
    setError(null);
    if (!supplierId) return setError("Pick a supplier.");
    if (validLines.length === 0) return setError("Add at least one line with a part and quantity.");
    setSaving(true);
    const { data: po, error: poErr } = await supabase.from("purchase_orders").insert({ supplier_id: supplierId, status: "Draft" }).select("id").single();
    if (poErr) { setError(poErr.message); setSaving(false); return; }
    const rows = validLines.map((l) => {
      const part = parts.find((p) => p.id === l.part_id);
      return { po_id: po.id, part_id: l.part_id, description: part?.name || "Item", qty_ordered: Math.max(1, Math.round(Number(l.qty))), unit_cost: Number(l.cost || 0) };
    });
    const { error: itErr } = await supabase.from("purchase_order_items").insert(rows);
    setSaving(false);
    if (itErr) { setError(itErr.message); return; }
    setSupplierId(""); setLines([{ part_id: "", qty: "1", cost: "" }]); load();
  }

  const orderVal = (o) => (o.purchase_order_items || []).reduce((s, it) => s + Number(it.qty_ordered) * Number(it.unit_cost || 0), 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Purchase Orders</h1>
      <p className="mt-1 text-zinc-600">Order parts from a supplier, then receive them to add stock and record the bill in your books.</p>

      <form onSubmit={create} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={input}>
          <option value="">Choose supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={l.part_id} onChange={setLine(i, "part_id")} className={input + " flex-1"}>
                <option value="">Part…</option>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={l.qty} onChange={setLine(i, "qty")} type="number" min="1" placeholder="Qty" className="w-16 rounded-lg border border-zinc-300 px-2 py-2.5 text-right" />
              <input value={l.cost} onChange={setLine(i, "cost")} type="number" min="0" step="0.01" placeholder="Cost ea" className="w-24 rounded-lg border border-zinc-300 px-2 py-2.5 text-right" />
              <button type="button" onClick={() => removeLine(i)} aria-label="remove line" className="px-1 text-zinc-400 hover:text-red-500">✕</button>
            </div>
          ))}
          <button type="button" onClick={addLine} className="self-start text-sm font-medium text-red-600 hover:underline">+ add line</button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">Order value (ex GST): <strong className="text-zinc-800">{money(orderTotal)}</strong></span>
          <button type="submit" disabled={saving} className={btn + " disabled:opacity-50"}>{saving ? "Creating…" : "Create order"}</button>
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No purchase orders yet. Create your first above.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/purchase-orders/${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-zinc-50">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">{poNo(o.po_number)} <span className="font-normal text-zinc-500">· {o.suppliers?.name || "—"}</span></p>
                    <p className="text-sm text-zinc-500">{o.status === "Received" && o.received_date ? "received " + o.received_date : "ordered " + o.order_date}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-zinc-700">{money(orderVal(o))}</span>
                    <span className={"rounded-full px-2 py-0.5 text-xs font-semibold " + (STATUS_STYLES[o.status] || "bg-zinc-100 text-zinc-700")}>{o.status}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
