"use client";

// Hireage — gear let out by the day, living inside Rentals because it is the
// same idea on a shorter clock. Rates are GST-INCLUSIVE: Craig quotes "$150 for
// the day" and that is what the customer pays, so the invoice extracts the GST
// rather than adding it. Invoicing is due-on-receipt — a hire is paid as it goes
// out or comes back, not put on account.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const money = (n) => "$" + Number(n || 0).toFixed(2);
const nzDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ") : "");
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Hireage() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [hires, setHires] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [f, setF] = useState({ item_id: "", customer_id: "", hire_date: todayISO(), rate_type: "full", notes: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));

  async function load() {
    setLoading(true);
    const [i, h, c] = await Promise.all([
      supabase.from("hire_items").select("*").order("name"),
      supabase.from("hires").select("*, customers(name), hire_items(name, half_day_rate_incl_gst, full_day_rate_incl_gst), invoices(invoice_number, status)").order("hire_date", { ascending: false }).limit(50),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    if (i.error || h.error || c.error) setError((i.error || h.error || c.error).message);
    else { setItems(i.data || []); setHires(h.data || []); setCustomers(c.data || []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const chosen = items.find((i) => i.id === f.item_id);
  const chosenRate = chosen ? (f.rate_type === "half" ? chosen.half_day_rate_incl_gst : chosen.full_day_rate_incl_gst) : null;

  async function record(e) {
    e.preventDefault();
    setError(null);
    if (!f.item_id) return setError("Pick what's being hired.");
    if (!f.customer_id) return setError("Pick the customer. Add them under Customers first if they're not listed.");
    if (!f.hire_date) return setError("Enter the date.");
    const { error } = await supabase.from("hires").insert({
      item_id: f.item_id, customer_id: f.customer_id, hire_date: f.hire_date,
      rate_type: f.rate_type, notes: f.notes || null,
    });
    if (error) { setError(error.message); return; }
    setF((v) => ({ ...v, customer_id: "", notes: "" }));
    load();
  }

  async function invoiceHire(h) {
    setError(null); setBusy(h.id);
    const { data, error } = await supabase.rpc("generate_hire_invoice", { p_hire_id: h.id });
    setBusy(null);
    if (error) { setError(error.message); return; }
    if (data?.id) router.push("/invoices/" + data.id); else load();
  }

  return (
    <div>
      <form onSubmit={record} className="mt-4 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-zinc-900">Record a hire</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select value={f.item_id} onChange={set("item_id")} className={input}>
            <option value="">What&apos;s going out…</option>
            {items.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select value={f.customer_id} onChange={set("customer_id")} className={input}>
            <option value="">Who&apos;s taking it…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-600">Date
            <input value={f.hire_date} onChange={set("hire_date")} type="date" className={input} />
          </label>
          <label className="text-sm text-zinc-600">Half or full day
            <select value={f.rate_type} onChange={set("rate_type")} className={input}>
              <option value="half">Half day</option>
              <option value="full">Full day</option>
            </select>
          </label>
        </div>
        <input value={f.notes} onChange={set("notes")} placeholder="Notes (optional)" className={input} />
        {chosenRate != null && (
          <p className="text-xs text-zinc-500">
            They pay <span className="font-medium text-zinc-700">{money(chosenRate)}</span> — that&apos;s {money(chosenRate - Math.round(chosenRate * 3 / 23 * 100) / 100)} + {money(Math.round(chosenRate * 3 / 23 * 100) / 100)} GST.
          </p>
        )}
        <div>
          <button type="submit" className="rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700">Record hire</button>
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <h2 className="mt-8 font-semibold text-zinc-900">Recent hires</h2>
      {loading ? (
        <p className="mt-3 text-zinc-500">Loading…</p>
      ) : hires.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">Nothing hired out yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {hires.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">
                  {h.hire_items?.name} · {h.customers?.name}
                  {h.invoice_id && (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      invoiced #{String(h.invoices?.invoice_number ?? "").padStart(5, "0")}
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-zinc-500">
                  {h.rate_type === "half" ? "Half day" : "Full day"} · {nzDate(h.hire_date)}
                  {" · "}{money(h.rate_type === "half" ? h.hire_items?.half_day_rate_incl_gst : h.hire_items?.full_day_rate_incl_gst)}
                  {h.notes ? ` · ${h.notes}` : ""}
                </p>
              </div>
              {!h.invoice_id && (
                <button onClick={() => invoiceHire(h)} disabled={busy === h.id}
                  className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
                  {busy === h.id ? "Working…" : "Invoice it"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 font-semibold text-zinc-900">What we hire out</h2>
      <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 p-4 text-sm">
            <span className="font-medium text-zinc-900">{i.name}</span>
            <span className="text-zinc-600">{money(i.half_day_rate_incl_gst)} half day · {money(i.full_day_rate_incl_gst)} full day <span className="text-zinc-400">incl GST</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
