"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { PAYMENT_METHODS, DEFAULT_PAYMENT_METHOD } from "../../lib/paymentMethods";
import { useOwner } from "../RoleContext";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const invNo = (n) => String(n ?? 0).padStart(4, "0");

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [paidMap, setPaidMap] = useState({});
  // The payments themselves, not just their total — they can't be corrected
  // without being shown.
  const [payList, setPayList] = useState({});
  const [creditMap, setCreditMap] = useState({});
  const [filter, setFilter] = useState("unpaid"); // "unpaid" | "all"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState(DEFAULT_PAYMENT_METHOD);
  const [busy, setBusy] = useState(false);
  // A payment open for correction, and the boxes it's corrected in.
  const [fixingId, setFixingId] = useState(null);
  const [fixAmount, setFixAmount] = useState("");
  const [fixMethod, setFixMethod] = useState(DEFAULT_PAYMENT_METHOD);
  const owner = useOwner();

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
    const { data: pays } = await supabase
      .from("payments")
      .select("id, invoice_id, amount, method, created_at")
      .order("created_at");
    const pm = {};
    const pl = {};
    (pays || []).forEach((p) => {
      pm[p.invoice_id] = (pm[p.invoice_id] || 0) + Number(p.amount);
      (pl[p.invoice_id] = pl[p.invoice_id] || []).push(p);
    });
    setPaidMap(pm);
    setPayList(pl);
    // Credit notes reduce what's owed too, so a part-credited invoice doesn't
    // keep showing its full balance — or let someone be asked for it.
    const { data: cns } = await supabase.from("credit_notes").select("invoice_id, total");
    const cm = {};
    (cns || []).forEach((c) => { if (c.invoice_id) cm[c.invoice_id] = (cm[c.invoice_id] || 0) + Number(c.total); });
    setCreditMap(cm);
    setInvoices((invs || []).map((i) => ({ ...i, job: jobMap[i.job_card_id] || null })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const paidOf = (inv) => paidMap[inv.id] || 0;
  const creditedOf = (inv) => creditMap[inv.id] || 0;
  const balanceOf = (inv) => Math.round((Number(inv.total || 0) - paidOf(inv) - creditedOf(inv)) * 100) / 100;

  function startPayment(inv) {
    setError(null);
    setPayingId(inv.id);
    setPayAmount(balanceOf(inv).toFixed(2));
    setPayMethod(DEFAULT_PAYMENT_METHOD);
  }

  async function recordPayment(inv) {
    setError(null);
    const amt = Math.round((Number(payAmount) || 0) * 100) / 100;
    if (amt <= 0) { setError("Enter a payment amount."); return; }
    if (amt > balanceOf(inv) + 0.001) { setError("That's more than the balance owing (" + money(balanceOf(inv)) + ")."); return; }
    setBusy(true);
    const { error } = await supabase.from("payments").insert({ invoice_id: inv.id, amount: amt, method: payMethod });
    if (error) { setError("Couldn't record payment: " + error.message); setBusy(false); return; }
    if (paidOf(inv) + amt >= Number(inv.total) - 0.001 && inv.job_card_id) {
      await supabase.from("job_cards").update({ status: "Paid" }).eq("id", inv.job_card_id);
    }
    setPayingId(null); setPayAmount(""); setPayMethod(DEFAULT_PAYMENT_METHOD); setBusy(false); load();
  }

  // ---- Correcting a payment ---------------------------------------------------
  //
  // Until now a payment could be recorded and never touched again: a $1,000
  // entered where $100 was meant sat there permanently, and the invoice read as
  // settled when it wasn't.
  //
  // Corrections are done as a NEW payment followed by removing the old one,
  // rather than an UPDATE, and that is deliberate. The database keeps the books
  // straight through triggers that fire on INSERT and on DELETE — they post the
  // ledger entry, reverse it, and re-sync the invoice's status. There is no
  // UPDATE trigger, so editing a row in place would change the amount on screen
  // while leaving the ledger and the invoice status showing the old one.
  //
  // Order matters: the corrected payment goes in FIRST. If that fails, nothing
  // has been lost. Removing first and failing on the insert would lose a real
  // payment, which is the one outcome worth engineering against.
  // The invoice's own status is kept right by a database trigger. The JOB CARD's
  // is not — recordPayment() sets it to Paid from here, so undoing a payment has
  // to put it back, or the job sits on "Paid" while the invoice says money is
  // owing. Only a job that is currently Paid is touched; anything else is
  // somebody's deliberate state and is left alone.
  async function resyncJobStatus(invoiceId) {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv?.job_card_id) return;
    const [{ data: rows }, { data: jc }] = await Promise.all([
      supabase.from("payments").select("amount").eq("invoice_id", invoiceId),
      supabase.from("job_cards").select("status").eq("id", inv.job_card_id).maybeSingle(),
    ]);
    const paid = (rows || []).reduce((sum, r) => sum + Number(r.amount), 0);
    const covered = paid + creditedOf(inv) >= Number(inv.total || 0) - 0.001;
    if (!covered && jc?.status === "Paid") {
      await supabase.from("job_cards").update({ status: "Invoiced" }).eq("id", inv.job_card_id);
    }
  }

  function startFix(p) {
    setError(null);
    setFixingId(p.id);
    setFixAmount(Number(p.amount).toFixed(2));
    setFixMethod(p.method || DEFAULT_PAYMENT_METHOD);
  }

  async function saveFix(p) {
    setError(null);
    const amt = Math.round((Number(fixAmount) || 0) * 100) / 100;
    if (amt <= 0) { setError("Enter a payment amount, or remove the payment instead."); return; }
    setBusy(true);

    const { error: insErr } = await supabase
      .from("payments")
      .insert({ invoice_id: p.invoice_id, amount: amt, method: fixMethod });
    if (insErr) { setError("Couldn't save the correction: " + insErr.message); setBusy(false); return; }

    const { error: delErr } = await supabase.from("payments").delete().eq("id", p.id);
    if (delErr) {
      setError(
        "The corrected payment was saved, but the original couldn't be removed (" +
        delErr.message + "). Remove it below so the invoice isn't double-counted."
      );
    }
    await resyncJobStatus(p.invoice_id);
    setFixingId(null); setBusy(false); load();
  }

  async function removePayment(p) {
    if (!window.confirm("Remove this payment of " + money(p.amount) + "? The invoice will go back to owing it.")) return;
    setError(null); setBusy(true);
    const { error } = await supabase.from("payments").delete().eq("id", p.id);
    if (error) setError("Couldn't remove that payment: " + error.message);
    else await resyncJobStatus(p.invoice_id);
    setBusy(false);
    load();
  }

  // Credited is settled, the same as Paid — it just settled by being written
  // off rather than by being banked. Counting it as outstanding overstates what
  // the shop is owed.
  const settled = (i) => i.status === "Paid" || i.status === "Credited";
  const shown = filter === "unpaid" ? invoices.filter((i) => !settled(i)) : invoices;
  const outstanding = invoices.filter((i) => !settled(i)).reduce((s, i) => s + balanceOf(i), 0);

  const tab = (key, label) =>
    <button onClick={() => setFilter(key)} className={filter === key ? "rounded-md bg-red-600 px-3 py-1 font-medium text-white" : "px-3 py-1 font-medium text-zinc-600 hover:text-zinc-900"}>{label}</button>;

  const badge = (status) => {
    const map = { "Paid": "bg-emerald-50 text-emerald-700", "Credited": "bg-violet-50 text-violet-700", "Part-paid": "bg-amber-50 text-amber-700", "Unpaid": "bg-zinc-100 text-zinc-600" };
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
                    <p className="font-medium text-zinc-900">
                      <Link href={`/invoices/${inv.id}`} className="hover:underline">Invoice #{invNo(inv.invoice_number)}</Link>
                      <span className="text-sm font-normal text-zinc-500"> · {money(inv.total)}</span>
                    </p>
                    <p className="truncate text-sm text-zinc-500">
                      {inv.job?.customers?.name || "—"}
                      {inv.job?.job_number ? " · Job #" + inv.job.job_number : ""}
                      {!paid && paidOf(inv) > 0 ? " · paid " + money(paidOf(inv)) + " · owing " + money(bal) : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Link href={`/invoices/${inv.id}`} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">View</Link>
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
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} aria-label="How it was paid" className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100">
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button disabled={busy} onClick={() => recordPayment(inv)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "…" : "Save payment"}</button>
                    <button onClick={() => { setPayingId(null); setPayAmount(""); }} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">Cancel</button>
                  </div>
                )}

                {owner && (payList[inv.id] || []).length > 0 && (
                  <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">Payments received</p>
                    <ul className="flex flex-col gap-1 text-sm">
                      {(payList[inv.id] || []).map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center gap-2">
                          {fixingId === p.id ? (
                            <>
                              <input value={fixAmount} onChange={(e) => setFixAmount(e.target.value)} type="number" min="0" step="0.01" aria-label="Corrected amount" className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-right text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
                              <select value={fixMethod} onChange={(e) => setFixMethod(e.target.value)} aria-label="How it was paid" className="rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100">
                                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <button disabled={busy} onClick={() => saveFix(p)} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{busy ? "…" : "Save"}</button>
                              <button onClick={() => setFixingId(null)} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">Cancel</button>
                            </>
                          ) : (
                            <>
                              <span className="font-medium text-zinc-800">{money(p.amount)}</span>
                              <span className="text-zinc-500">{p.method || "—"}</span>
                              <span className="text-zinc-400">{p.created_at ? new Date(p.created_at).toLocaleDateString("en-NZ") : ""}</span>
                              <button onClick={() => startFix(p)} className="text-xs font-medium text-zinc-600 hover:underline">edit</button>
                              <button disabled={busy} onClick={() => removePayment(p)} className="text-xs text-red-500 hover:underline disabled:opacity-50">remove</button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
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
