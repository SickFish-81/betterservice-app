"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { useOwner } from "../RoleContext";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const money = (n) => "$" + Number(n || 0).toFixed(2);

// Margin on the sale price, which is the number that answers "are we actually
// making anything on this". Blank rather than 0% when cost hasn't been entered,
// because 100% margin on an unset cost is a lie the page shouldn't tell.
function marginPct(costPrice, salePrice) {
  const c = Number(costPrice || 0);
  const sale = Number(salePrice || 0);
  if (!(c > 0) || !(sale > 0)) return null;
  return Math.round(((sale - c) / sale) * 100);
}

export default function PartsPage() {
  const owner = useOwner();
  const [parts, setParts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");   // what the customer pays
  const [cost, setCost] = useState("");     // what the shop pays its supplier
  const [qty, setQty] = useState("");
  const [minStock, setMinStock] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("parts").select("*, suppliers(name)").order("name");
    if (error) setError(error.message);
    else setParts(data || []);
    const { data: sup } = await supabase.from("suppliers").select("id, name, is_active").order("name");
    setSuppliers((sup || []).filter((s) => s.is_active));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addPart(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("parts").insert({
      name, sku: sku || null,
      unit_price: Number(price || 0),
      cost_price: Number(cost || 0),
      qty_on_hand: Number(qty || 0), min_stock: Number(minStock || 0),
      supplier_id: supplierId || null,
    });
    if (error) { setError(error.message); return; }
    setName(""); setSku(""); setPrice(""); setCost(""); setQty(""); setMinStock(""); setSupplierId(""); load();
  }

  // Manual stock edits are logged as an adjustment (reason "Correction") so on-hand + history stay in sync.
  async function setStock(id, value, current) {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0 || n === Number(current)) return;
    const { error } = await supabase.rpc("record_stock_adjustment", { p_part_id: id, p_new_qty: n, p_reason: "Correction", p_note: null });
    if (error) setError(error.message);
    load();
  }

  // Editing a price in place. Needed as much as the box on the form: every part
  // already on file was added before there was anywhere to put a cost, so
  // without this the only way to enter one would be to delete and re-add.
  async function setPriceField(id, field, value, current) {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0 || n === Number(current)) return;
    const { error } = await supabase.from("parts").update({ [field]: n }).eq("id", id);
    if (error) { setError(error.message); return; }
    load();
  }

  async function setSupplier(id, value) {
    await supabase.from("parts").update({ supplier_id: value || null }).eq("id", id);
    load();
  }

  async function removePart(id) {
    if (!window.confirm("Remove this part?")) return;
    await supabase.from("parts").delete().eq("id", id);
    load();
  }

  const term = q.trim().toLowerCase();
  const low = parts.filter((p) => Number(p.qty_on_hand) <= Number(p.min_stock));
  let shown = term ? parts.filter((p) => (p.name + " " + (p.sku || "")).toLowerCase().includes(term)) : parts;
  if (lowOnly) shown = shown.filter((p) => Number(p.qty_on_hand) <= Number(p.min_stock));

  function exportReorder() {
    const rows = [["Reorder report"], ["Part", "SKU", "Supplier", "In stock", "Reorder at"]];
    low.forEach((p) => rows.push([p.name, p.sku || "", p.suppliers?.name || "", p.qty_on_hand, p.min_stock]));
    const csv = rows.map((r) => r.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "reorder-report.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Parts &amp; Inventory</h1>
      <p className="mt-1 text-zinc-600">Stock the shop sells or fits. Parts added to a job draw down from here; count and correct on the Stocktake page.</p>

      {low.length > 0 && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-amber-900">Reorder needed ({low.length})</h2>
            <button onClick={exportReorder} className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">Export CSV</button>
          </div>
          <ul className="mt-2 divide-y divide-amber-100">
            {low.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate text-amber-900">{p.name}{p.suppliers?.name && <span className="text-amber-700"> · {p.suppliers.name}</span>}</span>
                <span className="shrink-0 text-amber-800">{p.qty_on_hand} left · reorder at {p.min_stock}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={addPart} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Part name (e.g. Oil filter)" className={input} />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU / code (optional)" className={input} />
        <div className={`grid grid-cols-1 gap-3 ${owner ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2"}`}>
          {owner && <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" step="0.01" placeholder="Cost each (what you pay)" className={input} />}
          {owner && <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" placeholder="Sale price each" className={input} />}
          <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0" step="0.01" placeholder="Qty on hand" className={input} />
          <input value={minStock} onChange={(e) => setMinStock(e.target.value)} type="number" min="0" step="0.01" placeholder="Low-stock at" className={input} />
        </div>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={input}>
          <option value="">Supplier (optional)</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {owner && marginPct(cost, price) !== null && (
          <p className="-mt-1 text-xs text-zinc-500">
            Margin {marginPct(cost, price)}% · {money(Number(price) - Number(cost))} on each one
          </p>
        )}
        <button type="submit" className={btn}>Add part</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        <div className="flex items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts by name or SKU…" className={input} />
          <label className="flex shrink-0 items-center gap-1.5 text-sm text-zinc-600">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low only
          </label>
        </div>
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : parts.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No parts yet. Add your first one above.</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No parts match your filter.</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {shown.map((p) => {
              const isLow = Number(p.qty_on_hand) <= Number(p.min_stock);
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">{p.name} {p.sku && <span className="text-sm font-normal text-zinc-500">· {p.sku}</span>}</p>
                    <p className="text-sm text-zinc-500">{owner ? money(p.unit_price) + " each · " : ""}low-stock at {p.min_stock}</p>
                    {owner && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                        <label className="flex items-center gap-1">
                          cost
                          <input type="number" min="0" step="0.01" defaultValue={p.cost_price ?? 0}
                            onBlur={(e) => setPriceField(p.id, "cost_price", e.target.value, p.cost_price)}
                            className="w-20 rounded border border-zinc-200 px-1.5 py-0.5 text-right text-zinc-900 focus:border-red-500 focus:outline-none" />
                        </label>
                        <label className="flex items-center gap-1">
                          sale
                          <input type="number" min="0" step="0.01" defaultValue={p.unit_price ?? 0}
                            onBlur={(e) => setPriceField(p.id, "unit_price", e.target.value, p.unit_price)}
                            className="w-20 rounded border border-zinc-200 px-1.5 py-0.5 text-right text-zinc-900 focus:border-red-500 focus:outline-none" />
                        </label>
                        {marginPct(p.cost_price, p.unit_price) !== null ? (
                          <span className={marginPct(p.cost_price, p.unit_price) < 0 ? "font-semibold text-red-600" : "text-zinc-500"}>
                            {marginPct(p.cost_price, p.unit_price)}% margin
                          </span>
                        ) : (
                          <span className="text-amber-600">no cost entered</span>
                        )}
                      </div>
                    )}
                    <select value={p.supplier_id || ""} onChange={(e) => setSupplier(p.id, e.target.value)} className="mt-1 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs text-zinc-600 focus:border-red-500 focus:outline-none">
                      <option value="">No supplier</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {isLow && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">LOW</span>}
                    <label className="flex items-center gap-1 text-sm text-zinc-600">
                      <span className="hidden sm:inline">in stock</span>
                      <input type="number" min="0" step="0.01" defaultValue={p.qty_on_hand} onBlur={(e) => setStock(p.id, e.target.value, p.qty_on_hand)} className="w-16 rounded-lg border border-zinc-300 px-2 py-1 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
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
