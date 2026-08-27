"use client";

// One invoice, shown as the real PDF — not an HTML lookalike.
//
// The document in the frame below is built by the SAME code that produced the file
// the customer received (lib/invoicePdf.js). So "view", "print", "download" and
// "email again" are all the same artefact, and none of them can drift from the
// others as the app changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { buildInvoicePdf, pdfToBase64, pdfToObjectUrl, invoiceFileName, invNo } from "../../../lib/invoicePdf";
import { PAYMENT_TERMS, termsLabel } from "../../../lib/paymentTerms";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const btn = "rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50";

export default function InvoiceViewPage() {
  const { id } = useParams();
  const router = useRouter();

  const [invoice, setInvoice] = useState(null);
  const [job, setJob] = useState(null);
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState(null);
  const [payments, setPayments] = useState([]);
  const [owner, setOwner] = useState(false);
  const [senders, setSenders] = useState([]);
  const [senderId, setSenderId] = useState("");

  const [pdfUrl, setPdfUrl] = useState(null);
  const [source, setSource] = useState(null);   // "filed" = the archived copy | "draft" = regenerated
  const [docRef, setDocRef] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [savingTerms, setSavingTerms] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [emailTo, setEmailTo] = useState("");
  const frame = useRef(null);

  async function load() {
    setError(null);
    const [{ data: inv, error: iErr }, { data: st }, { data: isOwner }] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
      supabase.from("shop_settings").select("*").limit(1).maybeSingle(),
      supabase.rpc("is_owner"),
    ]);
    if (iErr) { setError(iErr.message); setLoading(false); return; }
    if (!inv) { setError("That invoice doesn't exist."); setLoading(false); return; }

    const [{ data: j }, { data: li }, { data: pays }, { data: staff }] = await Promise.all([
      supabase.from("job_cards").select("*, customers(*), machines(*)").eq("id", inv.job_card_id).maybeSingle(),
      supabase.from("job_line_items").select("*").eq("job_card_id", inv.job_card_id).order("created_at"),
      supabase.from("payments").select("*").eq("invoice_id", inv.id).order("created_at"),
      supabase.from("staff").select("id,name,can_send_invoices,role").eq("can_send_invoices", true),
    ]);

    setInvoice(inv); setJob(j || null); setItems(li || []); setSettings(st || null);
    setPayments(pays || []); setOwner(isOwner === true); setSenders(staff || []);
    setEmailTo(j?.customers?.email || "");

    // Default "sent by" to whoever is signed in — that's the right answer almost
    // every time, and it stops a send failing just because a dropdown was untouched.
    const { data: { user } } = await supabase.auth.getUser();
    const me = (staff || []).find((x) => (x.email || "").toLowerCase() === (user?.email || "").toLowerCase());
    setSenderId((prev) => prev || me?.id || (staff || [])[0]?.id || "");

    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // Which PDF to show, and why it matters:
  //
  // Once an invoice has been sent, the file that went to the customer is archived in
  // the private `invoices` bucket. THAT is the record. Re-drawing it from today's
  // template would show a document the customer never received — and the template
  // does change (the logo and text wrapping both changed on 27 Aug). An invoice
  // carries a GST number, so the archive has to win over a pretty reproduction.
  //
  // So: show the filed copy when there is one. Only render fresh when there isn't
  // (a draft, or an invoice generated before it was ever sent).
  useEffect(() => {
    let revoked = null;
    let cancelled = false;

    (async () => {
      if (!invoice || !job) return;

      // 1. The archived copy, if this invoice has been sent.
      if (invoice.pdf_url) {
        const { data, error } = await supabase.storage
          .from("invoices")
          .createSignedUrl(invoice.pdf_url, 3600);
        if (!cancelled && !error && data?.signedUrl) {
          setPdfUrl(data.signedUrl);
          setSource("filed");
          // Still build a document object so Download and Re-email have something
          // to work with, but it is NOT what the frame is showing.
          setDocRef(await buildInvoicePdf({ settings, invoice, job, items }));
          return;
        }
        // Fall through if the file has gone missing — better a fresh render than
        // an empty frame, as long as we say so.
      }

      // 2. Nothing filed: render from current data.
      const doc = await buildInvoicePdf({ settings, invoice, job, items });
      if (cancelled) return;
      const url = pdfToObjectUrl(doc);
      revoked = url;
      setDocRef(doc);
      setPdfUrl(url);
      setSource(invoice.pdf_url ? "missing" : "draft");
    })();

    // Blob URLs live until revoked; without this every reload leaks one.
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [invoice, job, items, settings]);

  const paid = useMemo(() => payments.reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);
  const balance = useMemo(
    () => Math.round((Number(invoice?.total || 0) - paid) * 100) / 100,
    [invoice, paid],
  );

  // Terms are stored, not held in the page — the database trigger derives due_date
  // from them, so the PDF and every report agree without the browser doing sums.
  async function changeTerms(next) {
    if (!invoice || next === invoice.payment_terms) return;
    if (invoice.sent && !window.confirm(
      "This invoice has already been sent. Changing the terms changes the due date on any copy you print or email from now on — the customer's existing copy will still show the old date.\n\nChange it?"
    )) return;
    setSavingTerms(true); setError(null);
    const { error } = await supabase.from("invoices").update({ payment_terms: next }).eq("id", invoice.id);
    setSavingTerms(false);
    if (error) { setError("Couldn't change the terms: " + error.message); return; }
    load();
  }

  function printIt() {
    // Print the PDF itself rather than the page around it, so what comes out of the
    // printer is the document — no nav, no buttons, no browser styling.
    const w = frame.current?.contentWindow;
    if (!w) { setError("The invoice is still rendering — try again in a second."); return; }
    w.focus();
    w.print();
  }

  async function download() {
    // Download whatever is on screen. If that's the archived copy, the customer's
    // actual file is what lands in Downloads — not a re-render of it.
    if (source === "filed" && pdfUrl) {
      try {
        const res = await fetch(pdfUrl);
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = invoiceFileName(invoice);
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      } catch {
        /* fall back to the rendered copy below */
      }
    }
    if (!docRef) return;
    docRef.save(invoiceFileName(invoice));
  }

  async function emailAgain() {
    setError(null); setNote(null);
    const to = emailTo.trim();
    if (!to) { setError("No email address to send to."); return; }
    if (!senderId) { setError("Choose who's sending it."); return; }
    if (!docRef) { setError("The invoice is still rendering — try again in a second."); return; }
    const already = invoice.sent
      ? `This invoice was already sent${invoice.sent_at ? " on " + new Date(invoice.sent_at).toLocaleDateString("en-NZ") : ""}.\n\nSend it to ${to} again?`
      : `Send invoice #${invNo(invoice.invoice_number)} to ${to}?`;
    if (!window.confirm(already)) return;

    setBusy("email");
    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("send-invoice", {
      body: {
        to,
        customerName: job?.customers?.name,
        invoiceNumber: invoice.invoice_number,
        total: invoice.total,
        pdfBase64: pdfToBase64(docRef),
        accessToken: session?.access_token || null,
      },
    });
    setBusy("");
    if (fErr || res?.error) {
      let detail = res?.error || fErr?.message || "Unknown error";
      try { if (fErr?.context?.json) { const b = await fErr.context.json(); if (b?.error) detail = b.error; } } catch (_e) {}
      setError("Couldn't send it: " + detail);
      return;
    }
    // Money is never re-sent from the browser — the invoice already holds the
    // server-computed totals and the lock trigger would reject a change anyway.
    await supabase.from("invoices")
      .update({ sent: true, sent_by: senderId, sent_at: new Date().toISOString(), pdf_url: res.pdfPath })
      .eq("id", invoice.id);
    setNote(res.emailError ? `Filed, but the email didn't go: ${res.emailError}` : `Sent to ${to}.`);
    load();
  }

  if (loading) return <main className="mx-auto max-w-3xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>;
  if (error && !invoice) return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <p className="text-red-600">{error}</p>
      <Link href="/invoices" className="mt-4 inline-block text-sm text-zinc-600 underline">Back to invoices</Link>
    </main>
  );

  const status = balance <= 0 ? "Paid" : paid > 0 ? "Part paid" : "Unpaid";
  const statusTone = balance <= 0 ? "bg-green-50 text-green-700" : paid > 0 ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-600";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/invoices" className="text-sm text-zinc-500 hover:text-zinc-800">← Invoices</Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
          Invoice #{invNo(invoice.invoice_number)}
        </h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone}`}>{status}</span>
      </div>

      <p className="mt-1 text-zinc-600">
        {job?.customers?.name || "—"}
        {job?.job_number ? <> · <Link href={`/jobs/${job.id}`} className="underline hover:text-zinc-900">job #{job.job_number}</Link></> : null}
        {invoice.issued_date ? ` · issued ${new Date(invoice.issued_date + "T00:00:00").toLocaleDateString("en-NZ")}` : ""}
      </p>

      {owner && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2"><dt className="text-zinc-500">Total</dt><dd className="font-medium text-zinc-900">{money(invoice.total)}</dd></div>
          <div className="flex gap-2"><dt className="text-zinc-500">Paid</dt><dd className="font-medium text-zinc-900">{money(paid)}</dd></div>
          <div className="flex gap-2"><dt className="text-zinc-500">Balance</dt><dd className="font-medium text-zinc-900">{money(balance)}</dd></div>
        </dl>
      )}

      {owner && (
        <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="min-w-[15rem] flex-1">
            <label className="block text-xs font-medium text-zinc-500">Payment terms</label>
            <select
              value={invoice.payment_terms || ""}
              onChange={(e) => changeTerms(e.target.value)}
              disabled={savingTerms}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
            >
              {PAYMENT_TERMS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="pb-1.5">
            <span className="block text-xs font-medium text-zinc-500">Due</span>
            <span className="text-sm font-semibold text-zinc-900">
              {invoice.due_date
                ? new Date(invoice.due_date + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })
                : "—"}
            </span>
          </div>
          {savingTerms && <span className="pb-2 text-xs text-zinc-400">saving…</span>}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <button onClick={printIt} className={`${btn} bg-zinc-900 text-white hover:bg-zinc-700`}>Print</button>
        <button onClick={download} className={`${btn} border border-zinc-300 text-zinc-700 hover:bg-zinc-50`}>Download PDF</button>

        {owner && (
          <>
            <div className="min-w-[12rem] flex-1">
              <label className="block text-xs font-medium text-zinc-500">Email to</label>
              <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} type="email" placeholder="customer@example.com"
                     className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500">Sent by</label>
              <select value={senderId} onChange={(e) => setSenderId(e.target.value)}
                      className="mt-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none">
                {senders.length === 0 && <option value="">No one can send invoices</option>}
                {senders.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button onClick={emailAgain} disabled={busy === "email"} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
              {busy === "email" ? "Sending…" : invoice.sent ? "Email again" : "Email to customer"}
            </button>
          </>
        )}
      </div>

      {owner && (
        <p className="mt-2 text-xs text-zinc-500">
          Sends from <span className="font-medium text-zinc-700">{settings?.invoice_bcc ? "admin@betterservice.co.nz" : "admin@betterservice.co.nz"}</span>
          {settings?.invoice_bcc ? <> · a copy goes to <span className="font-medium text-zinc-700">{settings.invoice_bcc}</span></> : null}
          {". "}
          &ldquo;Sent by&rdquo; records who did it, for the audit trail.
        </p>
      )}
      {invoice.sent && (
        <p className="mt-1 text-xs text-zinc-500">
          Last sent {invoice.sent_at ? new Date(invoice.sent_at).toLocaleString("en-NZ") : "—"}.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {note && <p className="mt-3 text-sm text-green-700">{note}</p>}

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          {source === "filed" ? "The invoice as sent" : "Exactly as it prints"}
        </h2>
        {source === "filed" && (
          <span className="text-xs text-zinc-500">
            Archived copy — the actual file the customer received, not a re-render.
          </span>
        )}
        {source === "draft" && (
          <span className="text-xs text-zinc-500">Not sent yet — generated from current details.</span>
        )}
        {source === "missing" && (
          <span className="text-xs text-amber-700">
            The filed copy couldn&apos;t be opened, so this is a fresh render — it may differ from what was sent.
          </span>
        )}
      </div>
      <div className="mt-2 overflow-hidden rounded-xl border border-zinc-300 bg-zinc-50 shadow-sm">
        {pdfUrl ? (
          <iframe ref={frame} src={pdfUrl} title={`Invoice ${invNo(invoice.invoice_number)}`} className="h-[80vh] w-full" />
        ) : (
          <p className="p-8 text-center text-sm text-zinc-500">Rendering the invoice…</p>
        )}
      </div>
    </main>
  );
}
