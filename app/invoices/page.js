"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const invNo = (n) => String(n ?? 0).padStart(4, "0");

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [paidMap, setPaidMap] = useState({});
  const [filter, setFilter] = useState("unpaid"); // "unpaid" | "all"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data: invs, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
    if (error) { setError(error.message); setLoading(false); return; }
    const jobIds = [...new Set((invs || []).map((i) => i.job_card_id).filter(Boolean))];
    let jobMap = {};
    if (jobIds.length) {
      const { data: jobs } = await supabase.from("job_cards").select("id, job_number, customers(name)").in("id", jobIds);
      jobMap = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
    }
    const { data: pays } = await supabase.from("payments").select("invoice_id, amount");
    const pm = {};
    (pays || []).forEach((p) => { pm[p.invoice_id] = (pm[p.invoice_id] || 0) + Number(p.amount); });
    setPaidMap(pm);
    setInvoices((invs || []).map((i) => ({ ...i, job: jobMap[i.job_card_id] || null })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const paidOf = (inv) => paidMap[inv.id] || 0;
  const balanceOf = (inv) => Math.round((Number(inv.total || 0) - paidOf(inv)) * 100) / 100;

  function startPayment(inv) {
    setError(null);
    setPayingId(inv.id);
    setPayAmount(balanceOf(inv).toFixed(2));
  }

  async function recordPayment(inv) {
    setError(null);
    const amt = Math.round((Number(payAmount) || 0) * 100) / 100;
    if (amt <= 0) { setError("Enter a payment amount."); return; }
    if (amt > balanceOf(inv) + 0.001) { setError("That's more than the balance owing (" + money(balanceOf(inv)) + ")."); return; }
    setBusy(true);
    const { error } = await supabase.from("payments").insert({ invoice_id: inv.id, amount: amt });
    if (error) { setError("Couldn't record payment: " + error.message); setBusy(false); return; }
    if (paidOf(inv) + amt >= Number(inv.total) - 0.001 && inv.job_card_id) {
      await supabase.from("job_cards").update({ status: "Paid" }).eq("id", inv.job_card_id);
    }
    setPayingId(null); setPayAmount(""); setBusy(false); load();
  }

  async function openPdf(p) {
    setError(null);
    if (!p) return;
    if (p.startsWith("http")) { window.open(p, "_blank"); return; }
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(p, 60);
    if (error) { setError("Couldn’t open PDF: " + error.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  const shown = filter === "unpaid" ? invoices.filter((i) => i.status !== "Paid") : invoices;
  const outstanding = invoices.filter((i) => i.status !== "Paid").reduce((s, i) => s + balanceOf(i), 0);

  const tab = (key, label) =>
    <button onClick={() => setFilter(key)} className={filter === key ? "rounded-md bg-red-600 px-3 py-1 font-medium text-white" : "px-3 py-1 font-medium text-zinc-600 hover:text-zinc-900"}>{label}</button>;

  const badge = (status) => {
    const map = { "Paid": "bg-emerald-50 text-emerald-700", "Part-paid": "bg-amber-50 text-amber-700", "Unpaid": "bg-zinc-100 text-zinc-600" };
    return <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + (map[status] || map.Unpaid)}>{status}</span>;
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Invoices</h1>
      <p className="mt-1 text-zinc-600">What&apos;s been billed, part-payments, and what&apos;s still owing.</p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
          {tab("unpaid", "Outstanding")}
          {tab("all", "All")}
        </div>
        <span className="text-sm text-zinc-600">Outstanding: <span className="font-semibold text-red-700">{money(outstanding)}</span></span>
      </div>

      {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">
          {filter === "unpaid" ? "Nothing outstanding — everything's paid. 🎉" : "No invoices yet."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {shown.map((inv) => {
            const paid = inv.status === "Paid";
            const bal = balanceOf(inv);
            return (
              <li key={inv.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">Invoice #{invNo(inv.invoice_number)} <span className="text-sm font-normal text-zinc-500">· {money(inv.total)}</span></p>
                    <p className="truncate text-sm text-zinc-500">
                      {inv.job?.customers?.name || "—"}
                      {inv.job?.job_number ? " · Job #" + inv.job.job_number : ""}
                      {!paid && paidOf(inv) > 0 ? " · paid " + money(paidOf(inv)) + " · owing " + money(bal) : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {inv.pdf_url && <button onClick={() => openPdf(inv.pdf_url)} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">PDF</button>}
                    {badge(inv.status)}
                    {!paid && payingId !== inv.id && (
                      <button onClick={() => startPayment(inv)} className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">Record payment</button>
                    )}
                  </div>
                </div>
                {payingId === inv.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <span className="text-sm text-zinc-600">Owing {money(bal)} — record</span>
                    <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} type="number" min="0" step="0.01" aria-label="Payment amount" className="w-28 rounded-lg border border-zinc-300 px-2 py-1 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                    <button disabled={busy} onClick={() => recordPayment(inv)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "…" : "Save payment"}</button>
                    <button onClick={() => { setPayingId(null); setPayAmount(""); }} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">Cancel</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
