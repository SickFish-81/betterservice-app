"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const invNo = (n) => String(n ?? 0).padStart(5, "0");

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [filter, setFilter] = useState("unpaid"); // "unpaid" | "all"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data: invs, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
    if (error) { setError(error.message); setLoading(false); return; }
    // Fetch the linked job (and its customer) separately, then join in JS.
    const jobIds = [...new Set((invs || []).map((i) => i.job_card_id).filter(Boolean))];
    let jobMap = {};
    if (jobIds.length) {
      const { data: jobs } = await supabase.from("job_cards").select("id, job_number, customers(name)").in("id", jobIds);
      jobMap = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
    }
    setInvoices((invs || []).map((i) => ({ ...i, job: jobMap[i.job_card_id] || null })));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function markPaid(inv) {
    setError(null);
    const { error } = await supabase.from("invoices").update({ status: "Paid" }).eq("id", inv.id);
    if (error) { setError("Couldn't mark paid — only owners can update a sent invoice."); return; }
    if (inv.job_card_id) await supabase.from("job_cards").update({ status: "Paid" }).eq("id", inv.job_card_id);
    load();
  }

  async function openPdf(p) {
    setError(null);
    if (!p) return;
    if (p.startsWith("http")) { window.open(p, "_blank"); return; }
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(p, 60);
    if (error) { setError("Couldn\u2019t open PDF: " + error.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  const shown = filter === "unpaid" ? invoices.filter((i) => i.status !== "Paid") : invoices;
  const outstanding = invoices.filter((i) => i.status !== "Paid").reduce((s, i) => s + Number(i.total || 0), 0);

  const tab = (key, label) =>
    <button onClick={() => setFilter(key)} className={filter === key ? "rounded-md bg-red-600 px-3 py-1 font-medium text-white" : "px-3 py-1 font-medium text-zinc-600 hover:text-zinc-900"}>{label}</button>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Invoices</h1>
      <p className="mt-1 text-zinc-600">What's been billed, and what's still owing.</p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
          {tab("unpaid", "Unpaid")}
          {tab("all", "All")}
        </div>
        <span className="text-sm text-zinc-600">Outstanding: <span className="font-semibold text-red-700">{money(outstanding)}</span></span>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

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
            return (
              <li key={inv.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">Invoice #{invNo(inv.invoice_number)} <span className="text-sm font-normal text-zinc-500">· {money(inv.total)}</span></p>
                  <p className="truncate text-sm text-zinc-500">
                    {inv.job?.customers?.name || "—"}
                    {inv.job?.job_number ? " · Job #" + inv.job.job_number : ""}
                    {inv.sent_at ? " · sent " + new Date(inv.sent_at).toLocaleDateString("en-NZ") : (inv.sent ? "" : " · draft")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {inv.pdf_url && <button onClick={() => openPdf(inv.pdf_url)} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">PDF</button>}
                  {paid ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Paid</span>
                  ) : (
                    <button onClick={() => markPaid(inv)} className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">Mark paid</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
