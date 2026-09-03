"use client";

// Awaiting approval — every rent invoice that has been prepared but not sent.
//
// Rent invoices used to go straight from the nightly job to the tenant's inbox.
// On 2 Sep 2026 one went out at a week's rent instead of a month's, and nobody
// saw it until the tenant did. Now generate-rental-invoices prepares the invoice
// and stops; this is where it waits.
//
// sent = false IS the awaiting-approval state — the same state a job-card
// invoice sits in between "generate" and "approve & send". There is no separate
// flag to keep in step, and an invoice can only ever be in one of two places.
//
// Approving calls send-rental-invoice, which emails the PDF THAT WAS ALREADY
// FILED, so what the tenant receives is what was looked at here.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const nzDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ") : "");
const invNo = (n) => "#" + String(n ?? "").padStart(5, "0");
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Approvals() {
  const [invoices, setInvoices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [senderId, setSenderId] = useState("");
  const [busy, setBusy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  async function load() {
    setLoading(true);
    const [inv, st] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, invoice_number, total, issued_date, due_date, period_start, pdf_url, customers(name, company_name, email), rental_agreements(rental_units(name))")
        .eq("kind", "rental")
        .eq("sent", false)
        .order("period_start", { ascending: true }),
      supabase.from("staff").select("id, name, can_send_invoices").order("name"),
    ]);
    if (inv.error) setError(inv.error.message);
    setInvoices(inv.data || []);
    setStaff(st.data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const senders = staff.filter((s) => s.can_send_invoices);

  async function openPdf(path) {
    setError(null);
    if (!path) { setError("No PDF was filed for this invoice."); return; }
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 60);
    if (error) { setError("Couldn't open the PDF: " + error.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function approveAndSend(inv) {
    if (!senderId) { setError("Choose who's sending — must be an owner who can send invoices."); return; }
    const who = inv.customers?.company_name || inv.customers?.name || "the tenant";
    if (!window.confirm(`Send invoice ${invNo(inv.invoice_number)} for ${money(inv.total)} to ${who}?`)) return;
    setError(null); setNote(null); setBusy(inv.id);
    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("send-rental-invoice", {
      body: { invoiceId: inv.id, sentBy: senderId, accessToken: session?.access_token || null },
    });
    setBusy(null);
    if (fErr || res?.error) {
      let detail = res?.error || (fErr && fErr.message) || "Unknown error";
      try { if (fErr?.context?.json) { const b = await fErr.context.json(); if (b?.error) detail = b.error; } } catch (_e) {}
      setError("Not sent: " + detail);
      return;
    }
    setNote(`${invNo(inv.invoice_number)} sent to ${res.to}${res.lease ? " with the lease agreement" : ""}.`);
    load();
  }

  // Discarding is deliberately available: a wrong invoice should be binned
  // here, not credit-noted after the tenant has seen it. Once it's gone the
  // nightly job will prepare that period again from the agreement.
  async function discard(inv) {
    if (!window.confirm(
      `Discard invoice ${invNo(inv.invoice_number)}?\n\nUse this when the rate or dates are wrong. Fix the tenancy first, and tonight's run will prepare it again.`
    )) return;
    setError(null);
    const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
    if (error) { setError(error.message); return; }
    load();
  }

  if (loading) return <p className="mt-6 text-zinc-500">Loading…</p>;

  return (
    <div className="mt-6">
      {invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center">
          <p className="font-medium text-zinc-700">Nothing waiting.</p>
          <p className="mt-1 text-sm text-zinc-500">Rent invoices appear here three days before each tenancy's period starts.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="flex flex-col">
              <span className="text-xs font-medium text-zinc-600">Sending as (owner only)</span>
              <select value={senderId} onChange={(e) => setSenderId(e.target.value)}
                      className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-zinc-900">
                <option value="">Select…</option>
                {senders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {senders.length === 0 && (
              <p className="text-xs text-amber-800">No one can send yet — mark Craig as “can send invoices” on the Staff page.</p>
            )}
          </div>

          <ul className="mt-4 flex flex-col gap-3">
            {invoices.map((inv) => {
              const late = inv.period_start && inv.period_start <= todayISO();
              const noEmail = !inv.customers?.email;
              return (
                <li key={inv.id}
                    className={"rounded-xl border p-4 shadow-sm " + (late ? "border-amber-300 bg-amber-50" : "border-zinc-200 bg-white")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-zinc-900">
                      {inv.rental_agreements?.rental_units?.name || "Unit"} — {inv.customers?.company_name || inv.customers?.name}
                    </p>
                    <p className="text-lg font-bold text-zinc-900">{money(inv.total)}</p>
                  </div>
                  <p className="mt-0.5 text-sm text-zinc-600">
                    {invNo(inv.invoice_number)} · period starts {nzDate(inv.period_start)} · due {nzDate(inv.due_date)}
                  </p>

                  {late && (
                    <p className="mt-2 text-sm font-medium text-amber-900">
                      This period has already started. If it's collected by automatic payment, the money may have left
                      the tenant's account against an invoice they haven't seen.
                    </p>
                  )}
                  {noEmail && (
                    <p className="mt-2 text-sm font-medium text-red-700">
                      No email address on file for this tenant — add one under Customers before sending.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => openPdf(inv.pdf_url)}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                      Check the PDF
                    </button>
                    <button onClick={() => approveAndSend(inv)} disabled={!senderId || noEmail || busy === inv.id}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy === inv.id ? "Sending…" : "Approve & send"}
                    </button>
                    <button onClick={() => discard(inv)}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
                      Discard
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {note && <p className="mt-3 text-sm text-emerald-700">{note}</p>}
      {error && <p className="mt-3 text-sm text-red-600">Error: {error}</p>}
    </div>
  );
}
