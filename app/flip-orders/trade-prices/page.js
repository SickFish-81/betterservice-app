"use client";

// FLIP trade prices — what dealers pay, excluding GST, by price tier.
//
// STANDARD is the base list: every product has (or needs) a Standard price.
// Every other tier only holds the prices where it differs; a blank cell means
// "same as Standard", and the page shows what that works out to. So a new
// tier starts identical to Standard and Craig only types what he wants
// cheaper (or dearer).
//
// Each dealer is on one tier (set on the Dealers page). Their portal orders
// are charged at that tier, and orders Craig types start from it — he can
// still change the price on a single order, and that order keeps it.
// Changing a price here never rewrites an invoice that has already gone.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { parseCents, centsToInput } from "../../../lib/flipTrade";

const ORDER = ["flip-standard", "flip-g3", "flip-road", "flip-starter-pack", "tie-downs", "d-rings"];
const cellKey = (tier, sku) => `${tier}|${sku}`;

export default function FlipTradePricesPage() {
  const [products, setProducts] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [saved, setSaved] = useState({});   // cellKey -> cents|null as stored
  const [draft, setDraft] = useState({});   // cellKey -> text
  const [newTier, setNewTier] = useState("");
  const [staffId, setStaffId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, t, tp] = await Promise.all([
      supabase.from("flip_trade_prices").select("sku, name, price_ex_gst"),
      supabase.from("flip_price_tiers").select("id, name, sort").order("sort"),
      supabase.from("flip_tier_prices").select("tier_id, sku, price_ex_gst"),
    ]);
    const err = p.error || t.error || tp.error;
    if (err) setError(err.message);
    const prods = (p.data || []).slice().sort((a, b) => ORDER.indexOf(a.sku) - ORDER.indexOf(b.sku));
    const s = {};
    for (const x of prods) s[cellKey("standard", x.sku)] = x.price_ex_gst;
    for (const x of tp.data || []) s[cellKey(x.tier_id, x.sku)] = x.price_ex_gst;
    setProducts(prods);
    setTiers(t.data || []);
    setSaved(s);
    setDraft(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, centsToInput(v)])));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("current_staff_id");
      if (data) setStaffId(data);
    })();
  }, []);

  const textOf = (k) => draft[k] ?? "";
  const changedKeys = Object.keys(draft).concat(Object.keys(saved))
    .filter((k, i, a) => a.indexOf(k) === i)
    .filter((k) => textOf(k).trim() !== centsToInput(saved[k] ?? null));
  const badKeys = changedKeys.filter((k) => textOf(k).trim() !== "" && parseCents(textOf(k)) === null);

  async function saveAll() {
    setError(null); setNotice(null);
    if (badKeys.length) return setError("Some prices aren't numbers. Type them like 90 or 90.00.");
    setBusy(true);
    const now = new Date().toISOString();
    for (const k of changedKeys) {
      const [tier, sku] = k.split("|");
      const text = textOf(k).trim();
      const cents = text === "" ? null : parseCents(text);
      let r;
      if (tier === "standard") {
        r = await supabase.from("flip_trade_prices").update({ price_ex_gst: cents, updated_at: now, updated_by: staffId }).eq("sku", sku);
      } else if (cents === null) {
        // Blank = back to the Standard price.
        r = await supabase.from("flip_tier_prices").delete().eq("tier_id", tier).eq("sku", sku);
      } else if (saved[k] === undefined || saved[k] === null) {
        r = await supabase.from("flip_tier_prices").insert({ tier_id: tier, sku, price_ex_gst: cents, updated_by: staffId });
      } else {
        r = await supabase.from("flip_tier_prices").update({ price_ex_gst: cents, updated_at: now, updated_by: staffId }).eq("tier_id", tier).eq("sku", sku);
      }
      if (r.error) { setBusy(false); setError(r.error.message); await load(); return; }
    }
    setBusy(false);
    setNotice(`Saved ${changedKeys.length} price${changedKeys.length === 1 ? "" : "s"}.`);
    await load();
  }

  async function addTier() {
    setError(null); setNotice(null);
    const name = newTier.trim();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    if (!id) return setError("Give the tier a name, e.g. Gold or Volume.");
    if (tiers.some((t) => t.id === id)) return setError(`There's already a tier called ${name}.`);
    setBusy(true);
    const { error: e } = await supabase.from("flip_price_tiers").insert({ id, name, sort: tiers.length });
    setBusy(false);
    if (e) return setError(e.message);
    setNewTier("");
    setNotice(`${name} added. It's the same as Standard until you type a different price.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <Link href="/flip-orders" className="text-sm text-zinc-600 underline">← FLIP orders</Link>
      <div className="mt-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">Trade prices</h1>
        <Link href="/flip-orders/dealers" className="text-sm font-medium text-red-700 underline">Dealers</Link>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        What a dealer pays for each product, <b>excluding GST</b>. <b>Standard</b> is the base price. In any
        other tier, leave a box blank to charge the Standard price. Each dealer is on one tier.
      </p>

      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {loading ? <p className="mt-6 text-zinc-500">Loading…</p> : (
        <>
          <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
                  <th className="px-3 py-2">Product</th>
                  {tiers.map((t) => <th key={t.id} className="px-3 py-2 text-right">{t.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const base = parseCents(textOf(cellKey("standard", p.sku)));
                  return (
                    <tr key={p.sku} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-2 text-zinc-900">{p.name}</td>
                      {tiers.map((t) => {
                        const k = cellKey(t.id, p.sku);
                        const text = textOf(k);
                        const changed = changedKeys.includes(k);
                        const bad = badKeys.includes(k);
                        return (
                          <td key={t.id} className="px-3 py-2 text-right align-top">
                            <label className="inline-flex items-center gap-1 text-zinc-500">
                              $
                              <input inputMode="decimal" value={text}
                                placeholder={t.id === "standard" ? "not set" : base !== null ? centsToInput(base) : "—"}
                                aria-label={`${p.name}, ${t.name} price excluding GST`}
                                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                                className={`w-24 rounded-lg border px-2 py-1.5 text-right text-sm text-zinc-900 placeholder:text-zinc-300 ${bad ? "border-red-500 bg-red-50" : changed ? "border-amber-400 bg-amber-50" : "border-zinc-300"}`} />
                            </label>
                            {t.id !== "standard" && text.trim() === "" && (
                              <span className="block text-[11px] text-zinc-400">same as Standard</span>
                            )}
                            {t.id === "standard" && text.trim() === "" && (
                              <span className="block text-[11px] text-amber-700">no Standard price</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button onClick={saveAll} disabled={busy || changedKeys.length === 0}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40">
              {busy ? "Saving…" : changedKeys.length ? `Save ${changedKeys.length} change${changedKeys.length === 1 ? "" : "s"}` : "No changes"}
            </button>
            <span className="ml-auto flex items-center gap-2">
              <input value={newTier} onChange={(e) => setNewTier(e.target.value)} placeholder="New tier, e.g. Gold"
                className="w-44 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm" />
              <button onClick={addTier} disabled={busy}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                Add tier
              </button>
            </span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            A product with no Standard price can't be ordered on the dealer portal; you can still type a price on an order yourself.
          </p>
        </>
      )}
    </main>
  );
}
