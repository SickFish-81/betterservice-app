"use client";

// Betterservice — Counter Sale (Phase 3e): quick over-the-counter retail, no job card.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const money = (n) => "$" + Number(n || 0).toFixed(2);
const saleNo = (n) => "CS-" + String(n ?? 0).padStart(5, "0");
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const METHODS = ["Cash", "Eftpos", "Card", "Bank transfer"];
const emptyLine = () => ({ part_id: "", description: "", qty: "1", price: "" });

export default function CounterSalePage() {
  const [customers, setCustomers] = useState([]);
  const [parts, setParts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [method, setMethod] = useState("Cash");
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function load() {
    setLoading(true);
    const { data: cust } = await supabase.from("customers").select("id, name").order("name");
    setCustomers(cust || []);
    const cash = (cust || []).find((c) => c.name === "Cash Sale");
    setCustomerId((prev) => prev || (cash ? cash.id : ""));
    const { data: pr } = await supabase.from("parts").select("id, name, unit_price, qty_on_hand").order("name");
    setParts(pr || []);
    const { data: st } = await supabase.from("shop_settings").select("*").eq("id", 1).single();
    setSettings(st || null);
    const { data: rec } = await supabase
      .from("counter_sales")
      .select("id, sale_number, total, payment_method, created_at, customers(name)")
      .order("created_at", { ascending: false })
      .limit(15);
    setRecent(rec || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function setLine(i, patch) { setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l))); }
  function pickPart(i, partId) {
    if (!partId) { setLine(i, { part_id: "", price: "" }); return; }
    const p = parts.find((x) => x.id === partId);
    setLine(i, { part_id: partId, description: p?.name || "", price: p ? String(p.unit_price) : "" });
  }
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const valid = lines.filter((l) => (l.description || l.part_id) && Number(l.qty) > 0 && Number(l.price) >= 0 && Number(l.qty) * Number(l.price) > 0);
  const subtotal = round2(valid.reduce((s, l) => s + Number(l.qty) * Number(l.price), 0));
  const gst = round2(subtotal * 0.15);
  const total = round2(subtotal + gst);

  async function complete() {
    setError(null); setDone(null);
    if (valid.length === 0) { setError("Add at least one item with a price."); return; }
    setSaving(true);
    const items = valid.map((l) => ({
      part_id: l.part_id || null,
      description: l.description || parts.find((p) => p.id === l.part_id)?.name || "Item",
      quantity: Math.max(0.01, round2(Number(l.qty))),
      unit_price: round2(l.price),
    }));
    const { data, error } = await supabase.rpc("create_counter_sale", { p_customer_id: customerId || null, p_items: items, p_method: method });
    setSaving(false);
    if (error) { setError(error.message); return; }
    const cust = customers.find((c) => c.id === customerId);
    setDone({ ...data, method, customer: cust?.name || "Cash Sale", lines: items });
    setLines([emptyLine()]);
    load();
  }

  function receipt(sale) {
    import("jspdf").then(({ jsPDF }) => {
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(18); doc.text(settings?.business_name || "Betterservice Te Puke", 20, y); y += 7;
      doc.setFontSize(10);
      if (settings?.address) { doc.text(settings.address, 20, y); y += 5; }
      if (settings?.phone) { doc.text("Ph: " + settings.phone, 20, y); y += 5; }
      if (settings?.gst_number) { doc.text("GST #: " + settings.gst_number, 20, y); y += 5; }
      y += 4;
      doc.setFontSize(14); doc.text("SALE RECEIPT  " + saleNo(sale.sale_number), 20, y); y += 8;
      doc.setFontSize(10);
      doc.text("Date: " + new Date().toLocaleDateString("en-NZ"), 20, y); y += 6;
      if (sale.customer && sale.customer !== "Cash Sale") { doc.text("Customer: " + sale.customer, 20, y); y += 6; }
      doc.line(20, y, 190, y); y += 6;
      (sale.lines || []).forEach((it) => {
        doc.text(String(it.description + "  (" + it.quantity + " x $" + Number(it.unit_price).toFixed(2) + ")").substring(0, 70), 20, y);
        doc.text("$" + (it.quantity * it.unit_price).toFixed(2), 190, y, { align: "right" });
        y += 6;
      });
      y += 2; doc.line(120, y, 190, y); y += 6;
      doc.text("Subtotal", 120, y); doc.text("$" + Number(sale.subtotal).toFixed(2), 190, y, { align: "right" }); y += 5;
      doc.text("GST 15%", 120, y); doc.text("$" + Number(sale.gst).toFixed(2), 190, y, { align: "right" }); y += 6;
      doc.setFontSize(12); doc.text("Total", 120, y); doc.text("$" + Number(sale.total).toFixed(2), 190, y, { align: "right" }); y += 8;
      doc.setFontSize(10); doc.text("Paid: " + (sale.method || "—"), 20, y); y += 8;
      doc.text("Thanks for your business!", 20, y);
      doc.save("Receipt-" + saleNo(sale.sale_number) + ".pdf");
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Counter Sale</h1>
      <p className="mt-1 text-zinc-600">Quick over-the-counter sale of parts &amp; accessories — no job card needed. Draws down stock and posts to your books.</p>

      {done && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Sale {saleNo(done.sale_number)} complete — {money(done.total)} ({done.method}).</p>
          <button onClick={() => receipt(done)} className="mt-2 rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100">Download receipt</button>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <label className="block">
          <span className="text-xs text-zinc-500">Customer</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={input}>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select value={l.part_id} onChange={(e) => pickPart(i, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-2 text-sm">
                <option value="">Custom item…</option>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.qty_on_hand})</option>)}
              </select>
              <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Description" className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-2 text-sm" />
              <input value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} type="number" min="0" step="0.01" aria-label="Quantity" className="w-14 rounded-lg border border-zinc-300 px-2 py-2 text-right text-sm" />
              <input value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} type="number" min="0" step="0.01" placeholder="Price" aria-label="Unit price" className="w-20 rounded-lg border border-zinc-300 px-2 py-2 text-right text-sm" />
              <button type="button" onClick={() => removeLine(i)} aria-label="remove item" className="px-1 text-zinc-400 hover:text-red-500">✕</button>
            </div>
          ))}
          <button type="button" onClick={addLine} className="self-start text-sm font-medium text-red-600 hover:underline">+ add item</button>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-zinc-600">
          <span>Subtotal: <strong>{money(subtotal)}</strong></span>
          <span>GST: <strong>{money(gst)}</strong></span>
          <span>Total: <strong className="text-zinc-900">{money(total)}</strong></span>
        </div>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-600">Payment
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <button onClick={complete} disabled={saving || total <= 0} className={btn + " ml-auto disabled:opacity-50"}>{saving ? "Saving…" : `Complete sale · ${money(total)}`}</button>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold text-zinc-900">Recent sales</h2>
      {loading ? (
        <p className="mt-2 text-zinc-500">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">No counter sales yet.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate text-zinc-800">{saleNo(r.sale_number)} <span className="text-zinc-400">· {r.customers?.name || "Cash Sale"}</span></p>
                <p className="text-xs text-zinc-400">{new Date(r.created_at).toLocaleString("en-NZ")}{r.payment_method ? " · " + r.payment_method : ""}</p>
              </div>
              <span className="shrink-0 font-medium text-zinc-900">{money(r.total)}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
