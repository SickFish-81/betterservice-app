"use client";

// Overdue invoices and payment reminders (migration 0096, Ben, 27 Nov 2026).
//
// Everything 14 or more days past its due date, grouped by customer. Reminders
// also go out automatically every 14 days (pg_cron, migration 0096). Here an
// owner can tick who to remind and send now: one email per customer listing all their
// overdue invoices, with the PDFs attached (send-payment-reminder). Each one is
// recorded, and a customer reminded in the last 6 days can't be sent another.
// Internal accounts (Betterservice's own) are listed but never emailed.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useOwner } from "../../RoleContext";

const MIN_DAYS = 14;
const QUIET_DAYS = 6;
const money = (n) => "$" + Number(n || 0).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nzDate = (d) => (d ? new Date(String(d).length > 10 ? d : d + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) : "");
const invNo = (n) => String(n ?? "").padStart(5, "0");
const btn = "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50";
const cancelBtn = "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50";

export default function OverduePage() {
  const owner = useOwner();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState({});      // customer_id -> true
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);    // { name, ok, message }

  async function load() {
    setError(null);
    const { data, error: e } = await supabase.rpc("overdue_invoices", { p_min_days: MIN_DAYS });
    if (e) { setError(e.message); setLoading(false); return; }
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // One card per customer.
  const groups = useMemo(() => {
    const by = {};
    for (const r of rows) {
      const k = r.customer_id || "none";
      (by[k] = by[k] || { id: r.customer_id, name: r.customer_name || "No customer", email: r.customer_email, excluded: r.excluded, invoices: [] }).invoices.push(r);
    }
    const quietSince = Date.now() - QUIET_DAYS * 86400000;
    return Object.values(by).map((g) => {
      const last = g.invoices.map((i) => i.last_reminded_at).filter(Boolean).sort().pop() || null;
      const total = g.invoices.reduce((s, i) => s + Number(i.balance), 0);
      const oldest = Math.max(...g.invoices.map((i) => i.days_overdue));
      const blocked = !g.id ? "No customer on the invoice"
        : g.excluded ? "Internal account: never reminded"
        : !g.email ? "No email on file: phone them"
        : last && new Date(last).getTime() > quietSince ? `Reminded ${nzDate(last)}: wait a week`
        : null;
      return { ...g, last, total, oldest, blocked };
    }).sort((a, b) => b.oldest - a.oldest);
  }, [rows]);

  // Tick everyone who can be reminded, once the list has loaded.
  useEffect(() => {
    const p = {};
    for (const g of groups) if (!g.blocked) p[g.id] = true;
    setPicked(p);
  }, [groups]);

  const chosen = groups.filter((g) => !g.blocked && picked[g.id]);
  const chosenTotal = chosen.reduce((s, g) => s + g.total, 0);
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  async function sendAll() {
    setSending(true); setConfirming(false); setResults([]); setError(null);
    const { data: { session } } = await supabase.auth.getSession();
    const out = [];
    for (const g of chosen) {
      const { data: res, error: fErr } = await supabase.functions.invoke("send-payment-reminder", {
        body: { customerId: g.id, accessToken: session?.access_token || null },
      });
      let detail = res?.error || res?.emailError || (fErr && fErr.message) || null;
      try { if (fErr && fErr.context && fErr.context.json) { const b = await fErr.context.json(); if (b && (b.error || b.emailError)) detail = b.error || b.emailError; } } catch (_e) {}
      const ok = !fErr && res?.emailed;
      out.push({ name: g.name, ok, message: ok ? `Sent to ${res.to}${res.missingPdfs?.length ? ` (no PDF on file for #${res.missingPdfs.map(invNo).join(", #")})` : ""}` : `Not sent: ${detail || "unknown error"}` });
      setResults([...out]);
    }
    setSending(false);
    load();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/invoices" className="text-sm text-zinc-600 underline">← Invoices</Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">Overdue</h1>
      <p className="mt-1 text-zinc-600">Invoices {MIN_DAYS} or more days past their due date. One reminder per customer, listing everything they owe, with the invoices attached.</p>
      <p className="mt-1 text-sm text-zinc-500">Reminders go out by themselves on weekday mornings, every {MIN_DAYS} days until it&apos;s paid. Use the button to send one now.</p>

      {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">Nothing is {MIN_DAYS}+ days overdue.</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-zinc-600">{groups.length} customer{groups.length === 1 ? "" : "s"} · <span className="font-semibold text-red-700">{money(grandTotal)}</span> overdue</p>
          <ul className="mt-3 flex flex-col gap-3">
            {groups.map((g) => (
              <li key={g.id || "none"} className={"rounded-xl border bg-white p-4 shadow-sm " + (g.blocked ? "border-zinc-200 opacity-75" : "border-zinc-200")}>
                <div className="flex items-start gap-3">
                  {owner && (
                    <input type="checkbox" className="mt-1 h-5 w-5 flex-none" aria-label={`Remind ${g.name}`}
                      checked={!g.blocked && !!picked[g.id]} disabled={!!g.blocked || sending}
                      onChange={(e) => setPicked((p) => ({ ...p, [g.id]: e.target.checked }))} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-zinc-900">{g.id ? <Link href={`/customers/${g.id}`} className="hover:underline">{g.name}</Link> : g.name}</p>
                      <p className="font-semibold text-red-700">{money(g.total)}</p>
                    </div>
                    <p className="text-xs text-zinc-500">{g.email || "no email"}{g.last && !g.blocked ? ` · last reminded ${nzDate(g.last)}` : ""}</p>
                    <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                      {g.invoices.map((i) => (
                        <li key={i.invoice_id} className="flex justify-between gap-2">
                          <span>#{invNo(i.invoice_number)} · {nzDate(i.issued_date)} · <span className={i.days_overdue >= 30 ? "font-medium text-red-700" : ""}>{i.days_overdue} days overdue</span></span>
                          <span>{money(i.balance)}</span>
                        </li>
                      ))}
                    </ul>
                    {g.blocked && <p className="mt-2 text-xs font-medium text-amber-800">{g.blocked}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {owner && (
            <div className="sticky bottom-4 mt-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-md">
              {!confirming ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-zinc-700">{chosen.length} reminder{chosen.length === 1 ? "" : "s"} · {money(chosenTotal)}</p>
                  <button onClick={() => setConfirming(true)} disabled={!chosen.length || sending} className={btn}>{sending ? "Sending…" : `Send ${chosen.length} reminder${chosen.length === 1 ? "" : "s"}`}</button>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-zinc-900">Email a payment reminder to:</p>
                  <p className="mt-1 text-sm text-zinc-700">{chosen.map((g) => g.name).join(" · ")}</p>
                  <div className="mt-3 flex gap-2">
                    <button onClick={sendAll} className={btn}>Yes, send them</button>
                    <button onClick={() => setConfirming(false)} className={cancelBtn}>Cancel</button>
                  </div>
                </div>
              )}
              {results.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm">
                  {results.map((r) => (
                    <li key={r.name} className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.name}: {r.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
