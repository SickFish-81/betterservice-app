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
//
// ADJUSTING (19 Oct 2026). Until now a wrong invoice had two ways out and no
// third: discard it, which only helps when the fault is in the tenancy, or send
// it and credit-note it, which is the thing this screen exists to avoid. So the
// rate and the dates can now be corrected in place.
//
// Three things make that safe, and all three are in the database rather than
// here, because a guard that lives in a screen is a guard somebody can go
// around:
//
//   - invoice_adjustable() refuses once an invoice is sent, paid or credited.
//   - the totals re-add themselves from the lines (trg_resync_invoice_line_totals).
//   - the filed PDF is dropped the instant the money or dates move
//     (trg_invoice_pdf_stale), and send-rental-invoice refuses to send without
//     one. So a stale PDF cannot be emailed even if the rebuild below fails.
//
// The rebuild shares its PDF builder with the nightly run, on purpose: Craig has
// to be approving the document that will actually arrive.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import SentConfirmation from "../SentConfirmation";

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
  const [sent, setSent] = useState(null);   // confirmation after a rent invoice goes
  const [confirming, setConfirming] = useState(null);  // the invoice waiting on "yes, send it"
  // The invoice open for correction, its lines, and its dates.
  const [adjusting, setAdjusting] = useState(null);
  const [adjLines, setAdjLines] = useState([]);
  const [adjIssued, setAdjIssued] = useState("");
  const [adjPeriod, setAdjPeriod] = useState("");
  const [adjBusy, setAdjBusy] = useState(false);

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

  // Approving is two steps on purpose. The dates are the thing that goes wrong on
  // a rent invoice and the thing hardest to eyeball in a list, so they get a
  // window of their own that has to be read before anything is sent: issued on,
  // due on, and the period it covers, spelled out rather than implied.
  function askToSend(inv) {
    if (!senderId) { setError("Choose who's sending — must be an owner who can send invoices."); return; }
    setError(null); setNote(null);
    setConfirming(inv);
  }

  async function approveAndSend(inv) {
    setConfirming(null);
    if (!senderId) { setError("Choose who's sending — must be an owner who can send invoices."); return; }
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
    setSent({
      invoiceNumber: inv.invoice_number,
      to: res.to,
      total: inv.total,
      extra: res.lease ? "The lease agreement went with it." : null,
    });
    load();
  }

  async function startAdjust(inv) {
    setError(null); setNote(null);
    const { data, error } = await supabase
      .from("invoice_line_items")
      .select("id, description, quantity, unit_price")
      .eq("invoice_id", inv.id)
      .order("sort")
      .order("created_at");
    if (error) { setError("Couldn't read the lines: " + error.message); return; }
    setAdjLines((data || []).map((l) => ({ ...l, quantity: l.quantity ?? 1, unit_price: l.unit_price ?? 0 })));
    setAdjIssued(inv.issued_date || "");
    setAdjPeriod(inv.period_start || "");
    setAdjusting(inv);
  }

  // What it will come to, shown while it's being typed. GST is 15% ON TOP here:
  // rent is held exclusive, the same as a workshop invoice. The database does
  // this sum again for real - this is only so nobody saves blind.
  const adjSubtotal = adjLines.reduce(
    (t, l) => t + Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0) * 100) / 100, 0);
  const adjGst = Math.round(adjSubtotal * 0.15 * 100) / 100;
  const adjTotal = Math.round((adjSubtotal + adjGst) * 100) / 100;

  function setLine(i, field, value) {
    setAdjLines((ls) => ls.map((l, n) => (n === i ? { ...l, [field]: value } : l)));
  }

  // Lines first, then dates, then the paper. The lines are what the totals come
  // from, and the PDF has to be built from the finished figures - doing it in
  // any other order files a document that is already out of date.
  async function saveAdjust() {
    if (!adjusting) return;
    setError(null); setNote(null); setAdjBusy(true);
    const inv = adjusting;

    for (const l of adjLines) {
      const { error } = await supabase
        .from("invoice_line_items")
        .update({
          description: String(l.description ?? "").trim(),
          quantity: Number(l.quantity || 0),
          unit_price: Number(l.unit_price || 0),
        })
        .eq("id", l.id);
      if (error) { setAdjBusy(false); setError("Couldn't save that line: " + error.message); return; }
    }

    if (adjIssued !== (inv.issued_date || "") || adjPeriod !== (inv.period_start || "")) {
      const patch = {};
      if (adjIssued) patch.issued_date = adjIssued;      // due_date follows it, in the database
      if (adjPeriod) patch.period_start = adjPeriod;
      const { error } = await supabase.from("invoices").update(patch).eq("id", inv.id);
      if (error) { setAdjBusy(false); setError("Couldn't save the dates: " + error.message); return; }
    }

    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("generate-rental-invoices", {
      body: { rebuildInvoiceId: inv.id, accessToken: session?.access_token || null },
    });
    setAdjBusy(false);
    if (fErr || res?.error) {
      let detail = res?.error || (fErr && fErr.message) || "Unknown error";
      try { if (fErr?.context?.json) { const b = await fErr.context.json(); if (b?.error) detail = b.error; } } catch (_e) {}
      // The figures ARE saved; it is the document that isn't. Say which.
      setError("The invoice was corrected, but the PDF wasn't rebuilt: " + detail);
      setAdjusting(null);
      load();
      return;
    }

    setAdjusting(null);
    setNote(`${invNo(inv.invoice_number)} corrected and its PDF rebuilt — check it before approving.`);
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
                      This period has already started. If the tenant pays by automatic payment, the money may have
                      left their account against an invoice they haven't seen.
                    </p>
                  )}
                  {noEmail && (
                    <p className="mt-2 text-sm font-medium text-red-700">
                      No email address on file for this tenant — add one under Customers before sending.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => openPdf(inv.pdf_url)} disabled={!inv.pdf_url}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                      {inv.pdf_url ? "Check the PDF" : "No PDF filed"}
                    </button>
                    <button onClick={() => askToSend(inv)} disabled={!senderId || noEmail || busy === inv.id}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      {busy === inv.id ? "Sending…" : "Approve & send"}
                    </button>
                    <button onClick={() => startAdjust(inv)}
                            className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100">
                      Adjust
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

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
             role="dialog" aria-modal="true" aria-labelledby="confirm-dates-heading">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="confirm-dates-heading" className="text-lg font-bold text-zinc-900">Please confirm</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {confirming.rental_agreements?.rental_units?.name || "Unit"} — {confirming.customers?.company_name || confirming.customers?.name}
              {" · "}{invNo(confirming.invoice_number)}
            </p>

            <p className="mt-3 text-2xl font-bold text-zinc-900">{money(confirming.total)}</p>

            <dl className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                <dt className="text-sm text-zinc-600">Issue date</dt>
                <dd className="text-base font-semibold text-zinc-900">{nzDate(confirming.issued_date)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                <dt className="text-sm text-zinc-600">Due date</dt>
                <dd className="text-base font-semibold text-zinc-900">{nzDate(confirming.due_date)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                <dt className="text-sm text-zinc-600">Rent period starts</dt>
                <dd className="text-base font-semibold text-zinc-900">{nzDate(confirming.period_start)}</dd>
              </div>
            </dl>

            {/* The three-day gap in words, every time, rather than something to
                remember. This is the bit that gets miscounted. */}
            <p className="mt-3 text-sm text-zinc-600">
              Rent is invoiced three days before the period starts, and is due on the day it starts — so it can be
              paid before the period begins. Issued {nzDate(confirming.issued_date)}, due{" "}
              {nzDate(confirming.due_date)}.
            </p>

            {confirming.due_date !== confirming.period_start && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Heads up: the due date isn&apos;t the day the period starts. Check it&apos;s meant to be.
              </p>
            )}
            {confirming.period_start && confirming.period_start <= todayISO() && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This period has already started, so this invoice is going out late.
              </p>
            )}

            <p className="mt-3 text-xs text-zinc-500">
              Sending to {confirming.customers?.email}. If a date or the rate is wrong, cancel and use
              <strong> Adjust</strong> — nothing has left the building yet. Discard is for an invoice that
              shouldn&apos;t exist at all: fix the tenancy and tonight&apos;s run prepares the period again.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={() => approveAndSend(confirming)}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700">
                Yes, send it
              </button>
              <button onClick={() => setConfirming(null)}
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {adjusting && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
             role="dialog" aria-modal="true" aria-labelledby="adjust-heading">
          <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="adjust-heading" className="text-lg font-bold text-zinc-900">Correct this invoice</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {adjusting.rental_agreements?.rental_units?.name || "Unit"} — {adjusting.customers?.company_name || adjusting.customers?.name}
              {" · "}{invNo(adjusting.invoice_number)}
            </p>
            <p className="mt-2 text-sm text-zinc-600">
              Nothing has been sent, so this can be changed. Saving re-files the PDF, and the tenant sees only
              the corrected one.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {adjLines.map((l, i) => (
                <div key={l.id} className="rounded-xl border border-zinc-200 p-3">
                  <label className="flex flex-col">
                    <span className="text-xs font-medium text-zinc-600">What it&apos;s for</span>
                    <input value={l.description ?? ""} onChange={(e) => setLine(i, "description", e.target.value)}
                           className="mt-1 rounded-lg border border-zinc-300 px-2 py-2 text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                  </label>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="flex flex-col">
                      <span className="text-xs font-medium text-zinc-600">Qty</span>
                      <input value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)}
                             type="number" min="0" step="0.01"
                             className="mt-1 w-20 rounded-lg border border-zinc-300 px-2 py-2 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                    </label>
                    <label className="flex flex-col">
                      <span className="text-xs font-medium text-zinc-600">Each, GST exclusive</span>
                      <input value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)}
                             type="number" step="0.01"
                             className="mt-1 w-32 rounded-lg border border-zinc-300 px-2 py-2 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                    </label>
                    <span className="pb-2 text-sm font-medium text-zinc-700">
                      = {money(Math.round(Number(l.quantity || 0) * Number(l.unit_price || 0) * 100) / 100)}
                    </span>
                  </div>
                </div>
              ))}
              {adjLines.length === 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  This invoice has no lines, which shouldn&apos;t happen. Discard it and let tonight&apos;s run
                  prepare it again.
                </p>
              )}
            </div>

            <dl className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <dt className="text-sm text-zinc-600">Subtotal</dt>
                <dd className="font-semibold text-zinc-900">{money(adjSubtotal)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <dt className="text-sm text-zinc-600">GST 15%</dt>
                <dd className="font-semibold text-zinc-900">{money(adjGst)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                <dt className="text-sm font-medium text-zinc-700">Total</dt>
                <dd className="text-lg font-bold text-zinc-900">
                  {money(adjTotal)}
                  {Math.abs(adjTotal - Number(adjusting.total || 0)) > 0.005 && (
                    <span className="ml-2 text-sm font-normal text-zinc-500">was {money(adjusting.total)}</span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col">
                <span className="text-xs font-medium text-zinc-600">Issue date</span>
                <input value={adjIssued} onChange={(e) => setAdjIssued(e.target.value)} type="date"
                       className="mt-1 rounded-lg border border-zinc-300 px-2 py-2 text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
              </label>
              <label className="flex flex-col">
                <span className="text-xs font-medium text-zinc-600">Rent period starts</span>
                <input value={adjPeriod} onChange={(e) => setAdjPeriod(e.target.value)} type="date"
                       className="mt-1 rounded-lg border border-zinc-300 px-2 py-2 text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
              </label>
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              The due date follows the issue date and the payment terms — it isn&apos;t typed in, so it can&apos;t
              be set to something the terms don&apos;t allow.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button onClick={saveAdjust} disabled={adjBusy || adjLines.length === 0}
                      className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                {adjBusy ? "Saving and rebuilding…" : "Save and rebuild the PDF"}
              </button>
              <button onClick={() => setAdjusting(null)} disabled={adjBusy}
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <SentConfirmation
        open={!!sent}
        onClose={() => setSent(null)}
        invoiceNumber={sent?.invoiceNumber}
        to={sent?.to}
        total={sent?.total}
        extra={sent?.extra}
      />
    </div>
  );
}
