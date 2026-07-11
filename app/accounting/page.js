"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const CREDIT_TYPES = ["income", "liability", "equity"]; // natural credit-balance accounts
const card = "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm";

export default function AccountingPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    const { data: d, error } = await supabase.rpc("accounting_overview");
    if (error) { setError(/owners only/i.test(error.message) ? "owners" : error.message); setLoading(false); return; }
    setData(d);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Assets/expenses read debit-positive; income/liability/equity read credit-positive.
  const nat = (a) => (CREDIT_TYPES.includes(a.type) ? -Number(a.balance) : Number(a.balance));
  const accounts = data?.accounts || [];
  const byType = (t) => accounts.filter((a) => a.type === t);
  const sumType = (t) => byType(t).reduce((s, a) => s + nat(a), 0);
  const bal = (code) => Number(accounts.find((a) => a.code === code)?.balance || 0);

  const income = sumType("income");
  const expenses = sumType("expense");
  const profit = income - expenses;
  const gstOwed = -bal("200");   // liability: credit balance = owed
  const inBank = bal("100");
  const owedToYou = bal("110");

  if (loading) return <main className="mx-auto max-w-3xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>;
  if (error === "owners") return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Accounting</h1>
      <p className="mt-2 text-zinc-600">The books are owner-only. Ask Craig or Ben if you need access.</p>
    </main>
  );
  if (error) return <main className="mx-auto max-w-3xl px-4 py-8"><p className="text-sm text-red-600" role="alert">{error}</p></main>;

  const stat = (label, value, tone) => (
    <div className={card}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={"mt-1 text-lg font-bold " + (tone || "text-zinc-900")}>{money(value)}</p>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Accounting</h1>
      <p className="mt-1 text-zinc-600">Your live books — they update automatically as invoices are raised and paid.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stat("Income (excl. GST)", income)}
        {stat("Expenses", expenses)}
        {stat("Profit", profit, profit >= 0 ? "text-emerald-700" : "text-red-700")}
        {stat("GST owed", gstOwed)}
        {stat("In the bank", inBank)}
        {stat("Owed to you (unpaid)", owedToYou)}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-zinc-900">Income by month</h2>
      {(data?.monthly_income || []).length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">No income yet — it&apos;ll show here once you raise your first invoice.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {data.monthly_income.map((m) => (
            <div key={m.month} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm last:border-0">
              <span className="text-zinc-600">{m.month}</span>
              <span className="font-semibold text-zinc-900">{money(m.income)}</span>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold text-zinc-900">Trial balance</h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        {["asset", "liability", "equity", "income", "expense"].map((t) => (
          <div key={t}>
            <p className="bg-zinc-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t}</p>
            {byType(t).map((a) => (
              <div key={a.code} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm last:border-0">
                <span className="text-zinc-700">{a.code} · {a.name}</span>
                <span className="font-medium text-zinc-900">{money(nat(a))}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-zinc-900">Recent transactions</h2>
      {(data?.recent || []).length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">Nothing posted yet.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {data.recent.map((r, i) => (
            <div key={i} className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-sm last:border-0">
              <span className="truncate pr-3 text-zinc-700">{r.date} · {r.memo}</span>
              <span className="shrink-0 font-medium text-zinc-900">{money(r.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-500">A working set of books, not professional advice — have your accountant review before you file GST.</p>
    </main>
  );
}
