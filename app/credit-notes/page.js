"use client";

import { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const cnNo = (n) => "CN-" + String(n ?? 0).padStart(5, "0");
const invNo = (n) => "#" + String(n ?? 0).padStart(5, "0");
const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";

export default function CreditNotesPage() {
  const [notes, setNotes] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [invoiceId, setInvoiceId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [reason, setReason] = useState("");

  async function load() {
    setLoading(true);
    const { data: cn } = await supabase.from("credit_notes")
      .select("*, invoices(invoice_number), customers(name)").order("created_at", { ascending: false });
    const { data: inv } = await supabase.from("invoices")
      .select("id, invoice_number, subtotal, gst, total, job_cards(customer_id, customers(name))")
      .order("invoice_number", { ascending: false });
    const { data: cust } = await supabase.from("customers").select("id, name").order("name");
    const { data: st } = await supabase.from("shop_settings").select("*").eq("id", 1).single();
    setNotes(cn || []); setInvoices(inv || []); setCustomers(cust || []); setSettings(st || null);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const sub = Math.max(0, Number(subtotal) || 0);
  const gst = Math.round(sub * 0.15 * 100) / 100;
  const total = Math.round((sub + gst) * 100) / 100;

  function pickInvoice(id) {
    setInvoiceId(id);
    const iv = invoices.find((i) => i.id === id);
    if (iv) { setCustomerId(iv.job_cards?.customer_id || ""); setSubtotal(String(iv.subtotal)); }
  }

  function buildPdf(note, customerName) {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18); doc.text(settings?.business_name || "Betterservice Tepuke", 20, y); y += 7;
    doc.setFontSize(10); doc.setTextColor(110);
    if (settings?.address) { doc.text(String(settings.address), 20, y); y += 5; }
    if (settings?.phone) { doc.text(String(settings.phone), 20, y); y += 5; }
    if (settings?.gst_number) { doc.text("GST: " + settings.gst_number, 20, y); y += 5; }
    doc.setTextColor(0); y += 6;
    doc.setFontSize(14); doc.text("CREDIT NOTE  " + cnNo(note.credit_note_number), 20, y); y += 8;
    doc.setFontSize(10);
    doc.text("Date: " + new Date(note.created_at).toLocaleDateString("en-NZ"), 20, y); y += 5;
    doc.text("Customer: " + (customerName || "—"), 20, y); y += 5;
    const iv = note.invoice_id ? invoices.find((i) => i.id === note.invoice_id) : null;
    if (iv) { doc.text("Against invoice: " + invNo(iv.invoice_number), 20, y); y += 5; }
    if (note.reason) { doc.text("Reason: " + note.reason, 20, y); y += 5; }
    y += 6;
    doc.text("Subtotal", 20, y); doc.text(money(note.subtotal), 180, y, { align: "right" }); y += 6;
    doc.text("GST (15%)", 20, y); doc.text(money(note.gst), 180, y, { align: "right" }); y += 6;
    doc.setFontSize(12); doc.text("Credit total", 20, y); doc.text(money(note.total), 180, y, { align: "right" }); y += 10;
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text("This credit note reduces the amount owing / credits your account.", 20, y);
    return doc;
  }

  async function issue(e) {
    e.preventDefault();
    setError(null);
    if (!invoiceId && !customerId) { setError("Pick an invoice or a customer."); return; }
    if (sub <= 0) { setError("Enter a credit amount."); return; }
    setBusy(true);
    const { data: row, error: insErr } = await supabase.from("credit_notes")
      .insert({ invoice_id: invoiceId || null, customer_id: customerId || null, reason: reason || null, subtotal: sub, gst, total })
      .select("*, customers(name)").single();
    if (insErr) { setError(insErr.message); setBusy(false); return; }
    try {
      const customerName = row.customers?.name || customers.find((c) => c.id === customerId)?.name;
      const blob = buildPdf(row, customerName).output("blob");
      const month = new Date(row.created_at).toISOString().slice(0, 7);
      const path = `credit-notes/${month}/CN-${String(row.credit_note_number).padStart(5, "0")}-${Date.now()}.pdf`;
      const { error: upErr } = await supabase.storage.from("invoices").upload(path, blob, { contentType: "application/pdf" });
      if (!upErr) await supabase.from("credit_notes").update({ pdf_url: path }).eq("id", row.id);
    } catch (_e) { /* PDF filing is best-effort; the credit note + ledger entry are already saved */ }
    setInvoiceId(""); setCustomerId(""); setSubtotal(""); setReason("");
    setBusy(false); load();
  }

  async function openPdf(p) {
    setError(null);
    if (!p) return;
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(p, 60);
    if (error) { setError("Couldn't open PDF: " + error.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Credit notes</h1>
      <p className="mt-1 text-zinc-600">Credit an invoice (full or partial) or issue a standalone credit. Each one reverses Sales &amp; GST in your books automatically.</p>

      {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}

      <form onSubmit={issue} className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cn-inv" className="mb-1 block text-sm font-medium text-zinc-700">Against invoice (optional)</label>
            <select id="cn-inv" value={invoiceId} onChange={(e) => pickInvoice(e.target.value)} className={input}>
              <option value="">— none / standalone —</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>{invNo(i.invoice_number)} · {i.job_cards?.customers?.name || "—"} · {money(i.total)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cn-cust" className="mb-1 block text-sm font-medium text-zinc-700">Customer</label>
            <select id="cn-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={!!invoiceId} className={input + (invoiceId ? " opacity-60" : "")}>
              <option value="">— choose —</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
          </div>
          <div>
            <label htmlFor="cn-sub" className="mb-1 block text-sm font-medium text-zinc-700">Credit amount (excl. GST)</label>
            <input id="cn-sub" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" className={input} />
          </div>
          <div>
            <label htmlFor="cn-reason" className="mb-1 block text-sm font-medium text-zinc-700">Reason</label>
            <input id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. returned part" className={input} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-600">GST {money(gst)} · <span className="font-semibold text-zinc-900">Credit total {money(total)}</span></p>
          <button disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy ? "Issuing…" : "Issue credit note"}</button>
        </div>
      </form>

      <div className="mt-6">
        {loading ? <p className="text-zinc-500">Loading…</p> : notes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No credit notes yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {notes.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">{cnNo(n.credit_note_number)} <span className="text-sm font-normal text-zinc-500">· {money(n.total)}</span></p>
                  <p className="truncate text-sm text-zinc-500">
                    {n.customers?.name || "—"}
                    {n.invoices?.invoice_number ? " · vs " + invNo(n.invoices.invoice_number) : ""}
                    {n.reason ? " · " + n.reason : ""}
                    {" · " + new Date(n.created_at).toLocaleDateString("en-NZ")}
                  </p>
                </div>
                {n.pdf_url && <button onClick={() => openPdf(n.pdf_url)} className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-800">PDF</button>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
