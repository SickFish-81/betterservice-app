"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const money = (n) => "$" + Number(n || 0).toFixed(2);

export default function PartsPage() {
  const [parts, setParts] = useState([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");
  const [minStock, setMinStock] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("parts").select("*").order("name");
    if (error) setError(error.message);
    else setParts(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addPart(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("parts").insert({
      name, sku: sku || null, unit_price: Number(price || 0),
      qty_on_hand: Number(qty || 0), min_stock: Number(minStock || 0),
    });
    if (error) { setError(error.message); return; }
    setName(""); setSku(""); setPrice(""); setQty(""); setMinStock(""); load();
  }

  async function setStock(id, value) {
    const n = Number(value);
    if (Number.isNaN(n)) return;
    await supabase.from("parts").update({ qty_on_hand: n }).eq("id", id);
    load();
  }

  async function removePart(id) {
    if (!window.confirm("Remove this part?")) return;
    await supabase.from("parts").delete().eq("id", id);
    load();
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? parts.filter((p) => (p.name + " " + (p.sku || "")).toLowerCase().includes(term))
    : parts;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Parts &amp; inventory</h1>
      <p className="mt-1 text-zinc-600">Stock the shop sells or fits. Parts added to a job will draw down from here.</p>

      <form onSubmit={addPart} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Part name (e.g. Oil filter)" className={input} />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU / code (optional)" className={input} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" placeholder="Price each" className={input} />
          <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0" placeholder="Qty on hand" className={input} />
          <input value={minStock} onChange={(e) => setMinStock(e.target.value)} type="number" min="0" placeholder="Low-stock at" className={input} />
        </div>
        <button type="submit" className={btn}>Add part</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts by name or SKU…" className={input} />
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : parts.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No parts yet. Add your first one above.</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No parts match "{q}".</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {shown.map((p) => {
              const low = Number(p.qty_on_hand) <= Number(p.min_stock);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">{p.name} {p.sku && <span className="text-sm font-normal text-zinc-500">· {p.sku}</span>}</p>
                    <p className="text-sm text-zinc-500">{money(p.unit_price)} each · low-stock at {p.min_stock}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {low && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">LOW</span>}
                    <label className="flex items-center gap-1 text-sm text-zinc-600">
                      <span className="hidden sm:inline">in stock</span>
                      <input type="number" min="0" defaultValue={p.qty_on_hand} onBlur={(e) => setStock(p.id, e.target.value)} className="w-16 rounded-lg border border-zinc-300 px-2 py-1 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                    </label>
                    <button onClick={() => removePart(p.id)} className="text-xs text-red-500 hover:underline">remove</button>
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
