"use client";

// FLIP reports — how the shop is actually going, by month.
//
// The orders list answers "what do I pack today". It cannot answer "is this
// working", because that question is about the shape of the last few months
// rather than the state of the bench. This page is that second question and
// nothing else.
//
// It reads and it writes exactly one thing: the freight cost, which no system
// anywhere knows and a human has to type off the courier docket. Everything
// else on here is arithmetic over rows the shop wrote.
//
// TWO DECISIONS WORTH KNOWING ABOUT BEFORE READING A NUMBER OFF THIS PAGE
//
// 1. Months are NEW ZEALAND months. created_at is stored in UTC, and NZ is 13
//    hours ahead in daylight time, so an order placed at 11am on the 1st of
//    the month is stamped 10pm UTC on the LAST DAY OF THE PREVIOUS ONE.
//    Bucketing on the raw timestamp would quietly move those orders into the
//    wrong month, and the total would still add up, which is the kind of wrong
//    that never gets found. Every bucket here goes through Pacific/Auckland.
//
// 2. Freight cost is only ever compared against the orders that HAVE one.
//    Summing the cost of three orders against the freight charged on eight
//    would show a margin that looks excellent and gets better every time
//    somebody forgets to enter a docket. So the comparison runs over the
//    costed orders alone, and the page says out loud how many that is.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);
const card = "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm";

// NZ GST. The shop's prices are GST inclusive, because that is what a customer
// is shown and what Stripe charged them. The ex-GST figure is the one that
// belongs on a tax return, so both appear rather than one being assumed.
const GST_RATE = 0.15;
const exGst = (cents) => Math.round(cents / (1 + GST_RATE));

// "2026-10" for whatever NZ calendar month the order landed in. en-CA because
// it formats as YYYY-MM-DD, which slices without parsing.
const nzMonthKey = (iso) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }).slice(0, 7);

const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-NZ", { month: "short", year: "numeric" });
};

const invoiceNo = (n) => (n ? "FLIP-" + n : "—");

export default function FlipReportsPage() {
  const [orders, setOrders] = useState([]);
  const [staffId, setStaffId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [draft, setDraft] = useState({}); // session_id -> what's typed in the box

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from("flip_orders")
      .select("session_id, created_at, invoice_number, name, email, address, items, amount_total, shipping_amount, freight_cost, packed_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (e) setError(e.message);
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Same lookup as the orders list: the staff row id, not the email. See the
  // note in AuthGate.js for why matching on email alone leaves the stamp
  // unattributable once an address has been cleared.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("current_staff_id");
      if (data) setStaffId(data);
    })();
  }, []);

  const months = useMemo(() => {
    const by = new Map();
    for (const o of orders) {
      const key = nzMonthKey(o.created_at);
      if (!by.has(key)) {
        by.set(key, { key, orders: 0, goods: 0, freight: 0, total: 0, costed: 0, costedFreight: 0, cost: 0 });
      }
      const m = by.get(key);
      const total = Number(o.amount_total || 0);
      const freight = Number(o.shipping_amount || 0);
      m.orders += 1;
      m.total += total;
      m.freight += freight;
      m.goods += total - freight;
      // Null means nobody has costed it. Zero means it genuinely cost nothing
      // — a customer who collected. Only the second belongs in the average.
      if (o.freight_cost !== null && o.freight_cost !== undefined) {
        m.costed += 1;
        m.costedFreight += freight;
        m.cost += Number(o.freight_cost);
      }
    }
    return [...by.values()].sort((a, b) => b.key.localeCompare(a.key));
  }, [orders]);

  const all = useMemo(() => {
    const z = { orders: 0, goods: 0, freight: 0, total: 0, costed: 0, costedFreight: 0, cost: 0 };
    for (const m of months) for (const k of Object.keys(z)) z[k] += m[k];
    return z;
  }, [months]);

  const uncosted = useMemo(
    () => orders.filter((o) => o.freight_cost === null || o.freight_cost === undefined),
    [orders]
  );

  async function saveCost(order) {
    const raw = (draft[order.session_id] ?? "").trim();
    if (raw === "") return;
    const dollars = Number(raw);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("That freight cost isn't a number I can store. Enter dollars, like 15.70.");
      return;
    }
    setBusy(order.session_id);
    setError(null);
    const { error: e } = await supabase
      .from("flip_orders")
      .update({
        freight_cost: Math.round(dollars * 100),
        freight_cost_entered_at: new Date().toISOString(),
        freight_cost_entered_by: staffId,
      })
      .eq("session_id", order.session_id);
    setBusy(null);
    if (e) { setError(e.message); return; }
    setDraft((d) => ({ ...d, [order.session_id]: "" }));
    // Reload rather than patch state locally: if the database refused the
    // write, the page must show what it actually holds, not what we hoped.
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">FLIP Reports</h1>
        <p className="text-xs text-zinc-500">monthly sales · flipbikes.co.nz</p>
        <Link href="/flip-orders" className="ml-auto text-sm font-medium text-red-700 underline">
          Back to orders
        </Link>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : orders.length === 0 ? (
        <p className={`mt-6 ${card} text-sm text-zinc-500`}>No orders yet.</p>
      ) : (
        <>
          <section className="mt-5">
            <p className="mb-1.5 ml-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
              Sales by month
            </p>
            <div className={`${card} overflow-x-auto p-0`}>
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                    <th className="px-3 py-2 font-semibold">Month</th>
                    <th className="px-3 py-2 text-right font-semibold">Orders</th>
                    <th className="px-3 py-2 text-right font-semibold">Goods</th>
                    <th className="px-3 py-2 text-right font-semibold">Freight</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-3 py-2 text-right font-semibold">Avg order</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.key} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-2 font-semibold text-zinc-900">{monthLabel(m.key)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{m.orders}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{money(m.goods)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{money(m.freight)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-zinc-900">{money(m.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-700">
                        {money(Math.round(m.total / m.orders))}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-zinc-300 bg-zinc-50">
                    <td className="px-3 py-2 font-bold text-zinc-900">All time</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-zinc-900">{all.orders}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-zinc-900">{money(all.goods)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-zinc-900">{money(all.freight)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-zinc-900">{money(all.total)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-zinc-900">
                      {all.orders ? money(Math.round(all.total / all.orders)) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 ml-0.5 text-xs text-zinc-500">
              Every figure is GST inclusive, because that is what the customer paid.
              All time that is {money(exGst(all.total))} excluding GST,
              with {money(all.total - exGst(all.total))} of GST in it.
              Months are New Zealand months, not UTC.
            </p>
          </section>

          <section className="mt-6">
            <p className="mb-1.5 ml-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
              Freight — charged against cost
            </p>
            {all.costed === 0 ? (
              <p className={`${card} text-sm text-zinc-600`}>
                Nothing costed yet. Enter what the courier charged on a few dockets below and this
                starts answering whether the freight pricing is right.
              </p>
            ) : (
              <div className={card}>
                <div className="flex flex-wrap gap-x-8 gap-y-3">
                  <Figure label="Charged" value={money(all.costedFreight)} />
                  <Figure label="Cost" value={money(all.cost)} />
                  <Figure
                    label={all.costedFreight - all.cost >= 0 ? "Ahead" : "Short"}
                    value={money(Math.abs(all.costedFreight - all.cost))}
                    tone={all.costedFreight - all.cost >= 0 ? "good" : "bad"}
                  />
                  <Figure
                    label="Per order"
                    value={money(Math.round((all.costedFreight - all.cost) / all.costed))}
                    tone={all.costedFreight - all.cost >= 0 ? "good" : "bad"}
                  />
                </div>
                {/* The sentence that stops this panel being misread. Without it
                    a partial sample reads as the whole business. */}
                <p className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                  Over the {all.costed} order{all.costed === 1 ? "" : "s"} that have a cost entered,
                  out of {all.orders}. The charged figure here counts only those same orders, so the
                  two sides are like for like.
                </p>
              </div>
            )}
          </section>

          {uncosted.length > 0 && (
            <section className="mt-6">
              <p className="mb-1.5 ml-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
                Freight not costed yet ({uncosted.length})
              </p>
              <ul className="space-y-2">
                {uncosted.map((o) => (
                  <li key={o.session_id} className={`${card} flex flex-wrap items-center gap-x-3 gap-y-2 py-3`}>
                    <span className="text-sm font-extrabold text-zinc-900">{invoiceNo(o.invoice_number)}</span>
                    <span className="truncate text-sm text-zinc-700">{o.name || o.email}</span>
                    <span className="text-xs text-zinc-500">
                      charged {money(o.shipping_amount)}
                      {o.address?.rural ? " · rural" : ""}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-sm text-zinc-500">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="cost"
                        value={draft[o.session_id] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [o.session_id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") saveCost(o); }}
                        className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums"
                      />
                      <button
                        onClick={() => saveCost(o)}
                        disabled={busy === o.session_id || (draft[o.session_id] ?? "").trim() === ""}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
                      >
                        {busy === o.session_id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 ml-0.5 text-xs text-zinc-500">
                What the courier charged, off the docket, GST included — the same basis as the
                freight we charged, so the two can be compared. Nothing to pay means 0, which is
                different from leaving it blank.
              </p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function Figure({ label, value, tone }) {
  const colour =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-zinc-900";
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${colour}`}>{value}</p>
    </div>
  );
}
