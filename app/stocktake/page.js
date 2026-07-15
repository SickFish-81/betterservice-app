"use client";

// Betterservice — Stock take (Phase 3a)
// Count what's on the shelf; only parts whose count differs get adjusted.
// Each change goes through record_stock_adjustment() so on-hand + history stay in sync.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const REASONS = ["Stocktake", "Correction", "Damaged", "Found", "Received", "Other"];
const fmtDelta = (d) => (d > 0 ? "+" + d : String(d));

export default function StocktakePage() {
  const [parts, setParts] = useState([]);
  const [counts, setCounts] = useState({});
  const [reason, setReason] = useState("Stocktake");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    const { data: p, error: pe } = await supabase
      .from("parts")
      .select("id, name, sku, qty_on_hand, min_stock, suppliers(name)")
      .order("name");
    if (pe) { setError(pe.message); setLoading(false); return; }
    setParts(p || []);
    const { data: h } = await supabase
      .from("stock_adjustments")
      .select("id, delta, new_qty, reason, note, created_at, parts(name)")
      .order("created_at", { ascending: false })
      .limit(20);
    setHistory(h || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const setCount = (id) => (e) => setCounts((c) => ({ ...c, [id]: e.target.value }));

  const pending = parts.filter((p) => {
    const v = counts[p.id];
    return v !== undefined && v !== "" && !Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) !== Number(p.qty_on_hand);
  });

  async function apply() {
    setError(null); setOk(null);
    if (pending.length === 0) { setError("Enter a count that differs from stock on at least one part."); return; }
    setSaving(true);
    let done = 0, failed = 0;
    for (const p of pending) {
      const { error } = await supabase.rpc("record_stock_adjustment", {
        p_part_id: p.id, p_new_qty: Math.round(Number(counts[p.id])), p_reason: reason, p_note: null,
      });
      if (error) failed++; else done++;
    }
    setSaving(false);
    setCounts({});
    setOk(`Recorded ${done} adjustment${done === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`);
    load();
  }

  const term = q.trim().toLowerCase();
  const shown = term ? parts.filter((p) => (p.name + " " + (p.sku || "")).toLowerCase().includes(term)) : parts;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Stocktake</h1>
      <p className="mt-1 text-zinc-600">Count what's on the shelf and enter it. Only parts whose count differs are adjusted — every change is logged below and can be re-corrected any time.</p>

      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <label className="block">
          <span className="text-xs text-zinc-500">Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm">
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button onClick={apply} disabled={saving || pending.length === 0} className={btn + " ml-auto disabled:opacity-50"}>
          {saving ? "Saving…" : `Apply counts (${pending.length})`}
        </button>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {ok && <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

      <div className="mt-5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts…" className={input} />
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : parts.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No parts yet — add some on the Parts page first.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <span>Part</span><span className="text-right">In stock</span><span className="text-right">Counted</span>
            </div>
            {shown.map((p) => {
              const v = counts[p.id];
              const diff = v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) - Number(p.qty_on_hand) : null;
              return (
                <div key={p.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-zinc-100 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-900">{p.name}{p.sku && <span className="font-normal text-zinc-400"> · {p.sku}</span>}</p>
                    {p.suppliers?.name && <p className="truncate text-xs text-zinc-400">{p.suppliers.name}</p>}
                  </div>
                  <span className="w-12 text-right text-zinc-700">{p.qty_on_hand}</span>
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" inputMode="numeric" value={v ?? ""} onChange={setCount(p.id)} placeholder="—"
                      className="w-16 rounded-lg border border-zinc-300 px-2 py-1 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                    {diff !== null && diff !== 0 && (
                      <span className={"w-8 text-right text-xs font-semibold " + (diff > 0 ? "text-emerald-700" : "text-red-700")}>{fmtDelta(diff)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-zinc-900">Recent adjustments</h2>
      {history.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">No adjustments recorded yet.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate text-zinc-800">{h.parts?.name || "—"} <span className="text-zinc-400">· {h.reason}</span></p>
                <p className="text-xs text-zinc-400">{new Date(h.created_at).toLocaleString("en-NZ")}{h.note ? " · " + h.note : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className={"font-semibold " + (h.delta > 0 ? "text-emerald-700" : "text-red-700")}>{fmtDelta(h.delta)}</span>
                <span className="ml-2 text-zinc-400">→ {h.new_qty}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
