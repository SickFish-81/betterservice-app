"use client";

// Betterservice — Reports (Phase 2b)
// Owner-only Profit & Loss and GST-return summaries for any date range,
// straight from the ledger via the owner-gated financial_report(from, to) RPC.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const card = "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const nzToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
const lastDay = (y, m) => new Date(y, m, 0).getDate();

function presetRange(key) {
  const today = nzToday();
  const [Y, M] = today.split("-").map(Number);
  if (key === "last_month") {
    const py = M === 1 ? Y - 1 : Y;
    const pm = M === 1 ? 12 : M - 1;
    return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
  }
  if (key === "this_fy") {
    const fy = M >= 4 ? Y : Y - 1; // NZ financial year starts 1 April
    return { from: ymd(fy, 4, 1), to: today };
  }
  // this_month (default)
  return { from: ymd(Y, M, 1), to: today };
}

const PRESETS = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_fy", label: "This financial year" },
  { key: "custom", label: "Custom" },
];

export default function ReportsPage() {
  const [preset, setPreset] = useState("this_month");
  const first = presetRange("this_month");
  const [from, setFrom] = useState(first.from);
  const [to, setTo] = useState(first.to);
  const [data, setData] = useState(null);
  const [bs, setBs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function choosePreset(key) {
    setPreset(key);
    if (key !== "custom") {
      const r = presetRange(key);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  async function run() {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    const [pl, sheet] = await Promise.all([
      supabase.rpc("financial_report", { p_from: from, p_to: to }),
      supabase.rpc("balance_sheet", { p_as_of: to }),
    ]);
    const err = pl.error || sheet.error;
    if (err) {
      setError(/owners only/i.test(err.message) ? "owners" : err.message);
      setLoading(false);
      return;
    }
    setData(pl.data);
    setBs(sheet.data);
    setLoading(false);
  }

  // Re-run whenever the selected period changes.
  useEffect(() => { run(); }, [from, to]);

  function exportCsv() {
    if (!data) return;
    const rows = [
      ["Betterservice — Financial report"],
      ["Period", data.from, "to", data.to],
      [],
      ["Profit & Loss (excl. GST)"],
      ["Code", "Income account", "Amount"],
    ];
    (data.income || []).forEach((r) => rows.push([r.code, r.name, Number(r.amount).toFixed(2)]));
    rows.push(["", "Total income", Number(data.income_total).toFixed(2)]);
    rows.push([]);
    rows.push(["Code", "Expense account", "Amount"]);
    (data.expenses || []).forEach((r) => rows.push([r.code, r.name, Number(r.amount).toFixed(2)]));
    rows.push(["", "Total expenses", Number(data.expense_total).toFixed(2)]);
    rows.push(["", "Net profit", Number(data.net_profit).toFixed(2)]);
    rows.push([]);
    rows.push(["GST return (15%)"]);
    rows.push(["", "GST collected on sales (output)", Number(data.gst?.output).toFixed(2)]);
    rows.push(["", "GST paid on purchases (input)", Number(data.gst?.input).toFixed(2)]);
    rows.push(["", Number(data.gst?.net) >= 0 ? "Net GST to pay" : "Net GST refund", Number(Math.abs(data.gst?.net || 0)).toFixed(2)]);

    if (bs) {
      rows.push([]);
      rows.push(["Balance sheet (as at " + bs.as_of + ")"]);
      rows.push(["Code", "Assets", "Amount"]);
      (bs.assets || []).forEach((r) => rows.push([r.code, r.name, Number(r.amount).toFixed(2)]));
      rows.push(["", "Total assets", Number(bs.assets_total).toFixed(2)]);
      rows.push(["Code", "Liabilities", "Amount"]);
      (bs.liabilities || []).forEach((r) => rows.push([r.code, r.name, Number(r.amount).toFixed(2)]));
      rows.push(["", "Total liabilities", Number(bs.liabilities_total).toFixed(2)]);
      rows.push(["Code", "Equity", "Amount"]);
      (bs.equity || []).forEach((r) => rows.push([r.code, r.name, Number(r.amount).toFixed(2)]));
      rows.push(["", "Current-year earnings", Number(bs.current_earnings).toFixed(2)]);
      rows.push(["", "Total equity", Number(bs.equity_total).toFixed(2)]);
      rows.push(["", "Total liabilities + equity", Number(bs.liabilities_and_equity).toFixed(2)]);
    }

    const csv = rows
      .map((r) => r.map((c) => {
        const s = String(c ?? "");
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `betterservice-report-${data.from}_to_${data.to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (error === "owners") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Reports</h1>
        <p className="mt-2 text-zinc-600">Reports are owner-only. Ask Craig or Ben if you need access.</p>
      </main>
    );
  }

  const gstNet = Number(data?.gst?.net || 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Reports</h1>
      <p className="mt-1 text-zinc-600">Profit &amp; Loss, GST return, and balance sheet — straight from your books.</p>

      {/* Period picker */}
      <div className={"mt-5 " + card}>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => choosePreset(p.key)}
              className={"rounded-md px-3 py-1.5 text-sm font-medium " + (preset === p.key ? "bg-red-600 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-zinc-500">From</span>
            <input type="date" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }}
              className="mt-1 block rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">To</span>
            <input type="date" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }}
              className="mt-1 block rounded-md border border-zinc-300 px-3 py-1.5 text-sm" />
          </label>
          <button onClick={exportCsv} disabled={!data || loading}
            className="ml-auto rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600" role="alert">{error}</p>
      ) : data ? (
        <>
          {/* Profit & Loss */}
          <h2 className="mt-8 text-lg font-semibold text-zinc-900">Profit &amp; Loss</h2>
          <p className="text-xs text-zinc-500">{data.from} to {data.to} · figures exclude GST</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <p className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Income</p>
            {(data.income || []).map((r) => (
              <div key={r.code} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
                <span className="text-zinc-700">{r.code} · {r.name}</span>
                <span className="font-medium text-zinc-900">{money(r.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-semibold text-zinc-900">Total income</span>
              <span className="font-semibold text-zinc-900">{money(data.income_total)}</span>
            </div>
            <p className="border-t border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Expenses</p>
            {(data.expenses || []).map((r) => (
              <div key={r.code} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
                <span className="text-zinc-700">{r.code} · {r.name}</span>
                <span className="font-medium text-zinc-900">{money(r.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-semibold text-zinc-900">Total expenses</span>
              <span className="font-semibold text-zinc-900">{money(data.expense_total)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-2.5">
              <span className="font-bold text-zinc-900">Net profit</span>
              <span className={"font-bold " + (Number(data.net_profit) >= 0 ? "text-emerald-700" : "text-red-700")}>{money(data.net_profit)}</span>
            </div>
          </div>

          {/* GST return */}
          <h2 className="mt-8 text-lg font-semibold text-zinc-900">GST return</h2>
          <p className="text-xs text-zinc-500">{data.from} to {data.to} · 15% GST</p>
          <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
              <span className="text-zinc-700">GST collected on sales (output)</span>
              <span className="font-medium text-zinc-900">{money(data.gst?.output)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
              <span className="text-zinc-700">GST paid on purchases (input)</span>
              <span className="font-medium text-zinc-900">{money(data.gst?.input)}</span>
            </div>
            <div className="flex items-center justify-between bg-zinc-50 px-4 py-2.5">
              <span className="font-bold text-zinc-900">{gstNet >= 0 ? "Net GST to pay" : "Net GST refund"}</span>
              <span className={"font-bold " + (gstNet >= 0 ? "text-zinc-900" : "text-emerald-700")}>{money(Math.abs(gstNet))}</span>
            </div>
          </div>

          {/* Balance sheet */}
          {bs && (
            <>
              <h2 className="mt-8 text-lg font-semibold text-zinc-900">Balance sheet</h2>
              <p className="text-xs text-zinc-500">as at {bs.as_of}</p>
              <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                <p className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Assets</p>
                {(bs.assets || []).map((r) => (
                  <div key={r.code} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
                    <span className="text-zinc-700">{r.code} · {r.name}</span>
                    <span className="font-medium text-zinc-900">{money(r.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-semibold text-zinc-900">Total assets</span>
                  <span className="font-semibold text-zinc-900">{money(bs.assets_total)}</span>
                </div>
                <p className="border-t border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Liabilities</p>
                {(bs.liabilities || []).map((r) => (
                  <div key={r.code} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
                    <span className="text-zinc-700">{r.code} · {r.name}</span>
                    <span className="font-medium text-zinc-900">{money(r.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-semibold text-zinc-900">Total liabilities</span>
                  <span className="font-semibold text-zinc-900">{money(bs.liabilities_total)}</span>
                </div>
                <p className="border-t border-zinc-100 bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Equity</p>
                {(bs.equity || []).map((r) => (
                  <div key={r.code} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
                    <span className="text-zinc-700">{r.code} · {r.name}</span>
                    <span className="font-medium text-zinc-900">{money(r.amount)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm">
                  <span className="text-zinc-700">Current-year earnings</span>
                  <span className="font-medium text-zinc-900">{money(bs.current_earnings)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-semibold text-zinc-900">Total equity</span>
                  <span className="font-semibold text-zinc-900">{money(bs.equity_total)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-4 py-2.5">
                  <span className="font-bold text-zinc-900">Liabilities + equity</span>
                  <span className="font-bold text-zinc-900">{money(bs.liabilities_and_equity)}</span>
                </div>
              </div>
              <p className={"mt-2 text-xs " + (bs.balanced ? "text-emerald-700" : "text-red-700")}>
                {bs.balanced ? "✓ Balanced — assets equal liabilities plus equity." : "⚠ Not balanced — please check with your accountant."}
              </p>
            </>
          )}

          <p className="mt-6 text-xs text-zinc-500">
            A working set of books, not professional advice — have your accountant review before you file GST. Figures are on an invoice (accrual) basis: income and GST on sales are counted when an invoice is issued, and expenses when they&apos;re entered.
          </p>
        </>
      ) : null}
    </main>
  );
}
