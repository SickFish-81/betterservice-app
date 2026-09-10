"use client";

// The email report: who has been sent what, and did it arrive.
//
// Craig asked whether invoices were actually going out. They were — but nothing
// recorded it, so the only honest answer was "probably". Six ATV invoices had
// in fact never been emailed at all, and nobody knew. email_log now records
// every attempt from every sender; this page is where you look at it.
//
// Three questions, in the order they matter:
//   1. What HASN'T gone out?   (invoices_unsent) — the money still sitting there.
//   2. What went wrong?        (email_attention) — bounces and failures.
//   3. What has been sent?     (email_log)       — the full record.
//
// Owners only. email_log carries customer email addresses and is protected by
// an owner-read policy; the three views are security_invoker so they enforce it
// too. A mechanic loading this page would get empty lists, so it says why
// instead of looking broken.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useOwner } from "../RoleContext";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const invNo = (n) => "#" + String(n ?? 0).padStart(5, "0");

const when = (t) => {
  if (!t) return "";
  const d = new Date(t);
  return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) +
    " " + d.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
};

// What each sender calls itself, in words Craig would use.
const KINDS = {
  job_invoice: "Invoice",
  rental_invoice: "Rent invoice",
  service_reminder: "Service reminder",
  statement: "Statement",
  // The webhook writes this when a delivery report arrives for an email we have
  // no record of sending — one sent before this table existed, or from
  // elsewhere on the Resend account.
  unknown: "Other email",
};
const kindLabel = (k) => KINDS[k] || k;

// Resend's words, translated. "accepted" is the one worth being careful about:
// it means Resend took it, not that it landed.
// Every status resend-webhook is capable of writing, in plain words. Kept in
// step with that function deliberately: anything missing here would show Craig
// a raw database word like "delivery_delayed".
const STATUS = {
  delivered:        ["Delivered",      "bg-emerald-50 text-emerald-700 border-emerald-200"],
  opened:           ["Opened",         "bg-emerald-50 text-emerald-800 border-emerald-200"],
  accepted:         ["Sent",           "bg-blue-50 text-blue-700 border-blue-200"],
  sent:             ["Sent",           "bg-blue-50 text-blue-700 border-blue-200"],
  delivery_delayed: ["Delayed",        "bg-amber-50 text-amber-800 border-amber-200"],
  bounced:          ["Bounced",        "bg-red-50 text-red-700 border-red-200"],
  complained:       ["Marked as spam", "bg-red-50 text-red-700 border-red-200"],
  failed:           ["Failed",         "bg-red-50 text-red-700 border-red-200"],
};
function Pill({ status }) {
  const [label, cls] = STATUS[status] || [status || "—", "bg-zinc-100 text-zinc-600 border-zinc-200"];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

const card = "rounded-xl border bg-white p-4 shadow-sm";

export default function EmailsPage() {
  const owner = useOwner();
  const [log, setLog] = useState([]);
  const [unsent, setUnsent] = useState([]);
  const [attention, setAttention] = useState([]);
  const [names, setNames] = useState({});     // customer id -> name
  const [invNums, setInvNums] = useState({}); // invoice id -> number
  const [kind, setKind] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [l, u, a, c, i] = await Promise.all([
      supabase.from("email_log").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("invoices_unsent").select("*").order("days_waiting", { ascending: false }),
      supabase.from("email_attention").select("*").order("created_at", { ascending: false }),
      supabase.from("customers").select("id, name"),
      supabase.from("invoices").select("id, invoice_number"),
    ]);
    // A failure on any one of these shouldn't blank the whole page — show what
    // loaded and say what didn't.
    const problems = [l, u, a, c, i].map((r) => r.error?.message).filter(Boolean);
    if (problems.length) setError(problems.join(" · "));
    setLog(l.data || []);
    setUnsent(u.data || []);
    setAttention(a.data || []);
    setNames(Object.fromEntries((c.data || []).map((x) => [x.id, x.name])));
    setInvNums(Object.fromEntries((i.data || []).map((x) => [x.id, x.invoice_number])));
    setLoading(false);
  }

  useEffect(() => { if (owner) load(); else setLoading(false); }, [owner]);

  if (!owner) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Emails</h1>
        <p className="mt-3 text-zinc-700">
          This one is owners only — it lists customers&apos; email addresses and what has been sent to them.
        </p>
        <p className="mt-4 text-sm"><Link href="/dashboard" className="text-red-600 hover:underline">← Back to the dashboard</Link></p>
      </main>
    );
  }

  const term = q.trim().toLowerCase();
  const rows = log.filter((r) => {
    if (kind !== "all" && r.kind !== kind) return false;
    if (!term) return true;
    const hay = [r.to_email, r.subject, names[r.customer_id], invNums[r.invoice_id] ? invNo(invNums[r.invoice_id]) : ""]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(term);
  });

  const counts = log.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Emails</h1>
          <p className="mt-1 text-sm text-zinc-600">Who has been sent what, and whether it arrived.</p>
        </div>
        <button onClick={load} disabled={loading}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t load everything: {error}</p>}

      {/* 1. What hasn't gone out. First, because it's the money still sitting there. */}
      {unsent.length > 0 && (
        <section className={`mt-6 ${card} border-amber-200 bg-amber-50`}>
          <h2 className="font-semibold text-amber-900">Not sent yet · {unsent.length}</h2>
          <p className="mt-0.5 text-sm text-amber-800">Invoices raised but not emailed to anyone.</p>
          <div className="mt-3 space-y-2">
            {unsent.map((r) => (
              <div key={r.invoice_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg bg-white p-3">
                <span className="font-medium text-zinc-900">
                  <Link href={`/invoices/${r.invoice_id}`} className="hover:underline">{invNo(r.invoice_number)}</Link>
                  {" · "}{r.customer || "(no customer)"}
                </span>
                <span className="text-sm text-zinc-600">{r.reason}</span>
                <span className="font-semibold text-zinc-900">{money(r.total)}</span>
                <span className="text-xs text-zinc-500">{r.days_waiting} day{Number(r.days_waiting) === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. What went wrong. Hidden entirely when there's nothing wrong. */}
      {attention.length > 0 && (
        <section className={`mt-4 ${card} border-red-200 bg-red-50`}>
          <h2 className="font-semibold text-red-900">Didn&apos;t arrive · {attention.length}</h2>
          <p className="mt-0.5 text-sm text-red-800">Bounced or failed. These people did not get their email.</p>
          <div className="mt-3 space-y-2">
            {attention.map((r) => (
              <div key={r.id} className="rounded-lg bg-white p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-900">{kindLabel(r.kind)} · {r.to_email || "no address"}</span>
                  <Pill status={r.status} />
                </div>
                {(r.bounce_reason || r.error) && (
                  <p className="mt-1 text-xs text-red-700">{r.bounce_reason || r.error}</p>
                )}
                <p className="mt-1 text-xs text-zinc-500">{when(r.created_at)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. The record. */}
      <section className={`mt-4 ${card} border-zinc-200`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-zinc-900">Sent · {log.length}</h2>
          <div className="flex flex-wrap gap-2 text-xs text-zinc-600">
            {Object.entries(counts).map(([s, n]) => (
              <span key={s} className="inline-flex items-center gap-1"><Pill status={s} />{n}</span>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, address or invoice number…"
            className="min-w-[12rem] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100" />
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-red-500 focus:outline-none">
            <option value="all">Everything</option>
            {Object.entries(KINDS).filter(([k]) => k !== "unknown").map(([k, label]) => <option key={k} value={k}>{label}s</option>)}
          </select>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">
            {log.length === 0
              ? "Nothing logged yet. Every email the app sends from now on will appear here."
              : "Nothing matches that."}
          </p>
        ) : (
          <div className="mt-3 divide-y divide-zinc-100">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5">
                <span className="w-28 shrink-0 text-xs text-zinc-500">{when(r.created_at)}</span>
                <span className="min-w-[10rem] flex-1">
                  <span className="font-medium text-zinc-900">{kindLabel(r.kind)}</span>
                  {r.invoice_id && invNums[r.invoice_id] ? <span className="text-zinc-600"> {invNo(invNums[r.invoice_id])}</span> : null}
                  <span className="block text-sm text-zinc-600">
                    {names[r.customer_id] ? names[r.customer_id] + " · " : ""}{r.to_email || "no address"}
                  </span>
                </span>
                <Pill status={r.status} />
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-zinc-500">
          &quot;Sent&quot; means it left here and the mail service accepted it. &quot;Delivered&quot; means their mail
          server took it — that&apos;s the one that proves it arrived.
        </p>
      </section>
    </main>
  );
}
