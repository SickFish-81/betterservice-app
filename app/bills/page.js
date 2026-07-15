"use client";

// Betterservice — Bills to pay (Phase 3c)
// Open on-account bills (from Expenses + received POs) sitting in Accounts Payable.
// Recording a payment posts DR 210 Accounts Payable / CR 100 Bank and settles the bill.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const expNo = (n) => "EXP-" + String(n ?? 0).padStart(5, "0");

export default function BillsPage() {
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    const { data, error } = await supabase
      .from("expenses")
      .select("id, expense_number, expense_date, supplier, description, total, supplier_payments(amount)")
      .eq("paid_on_account", true)
      .eq("status", "Unpaid")
      .order("expense_date");
    if (error) { setError(error.message); setLoading(false); return; }
    setBills(data || []);
    const { data: pays, error: pe } = await supabase
      .from("supplier_payments")
      .select("id, amount, paid_date, method, expenses(expense_number, supplier)")
      .order("created_at", { ascending: false })
      .limit(20);
    if (pe) { setError(pe.message); setLoading(false); return; }
    setPayments(pays || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const paidOf = (b) => (b.supplier_payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const balanceOf = (b) => Math.round((Number(b.total) - paidOf(b)) * 100) / 100;
  const open = bills.filter((b) => balanceOf(b) > 0.005);
  const totalOwing = Math.round(open.reduce((s, b) => s + balanceOf(b), 0) * 100) / 100;

  function startPay(b) { setPayingId(b.id); setAmount(String(balanceOf(b))); setMethod("bank"); setError(null); }
  function cancelPay() { setPayingId(null); setAmount(""); }

  async function pay(b) {
    setError(null);
    const amt = Math.round(Number(amount) * 100) / 100;
    if (!(amt > 0)) { setError("Enter an amount greater than zero."); return; }
    if (amt > balanceOf(b) + 0.001) { setError("That's more than the balance owing (" + money(balanceOf(b)) + ")."); return; }
    setBusy(true);
    const { error } = await supabase.from("supplier_payments").insert({ expense_id: b.id, amount: amt, method });
    setBusy(false);
    if (error) { setError("Couldn't record payment: " + error.message); return; }
    cancelPay();
    load();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Bills to pay</h1>
      <p className="mt-1 text-zinc-600">Money you owe suppliers — from on-account expenses and received purchase orders. Recording a payment settles it in your books.</p>

      <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-xs text-zinc-500">Total owing (Accounts Payable)</p>
        <p className="mt-1 text-2xl font-bold text-zinc-900">{money(totalOwing)}</p>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      <div className="mt-5">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">Nothing owing — you're all paid up.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {open.map((b) => {
              const bal = balanceOf(b), paid = paidOf(b);
              return (
                <li key={b.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-900">{b.supplier || "—"} <span className="font-normal text-zinc-500">· {expNo(b.expense_number)}</span></p>
                      <p className="truncate text-sm text-zinc-500">{b.description || "Expense"} · {b.expense_date}{paid > 0 ? " · paid " + money(paid) : ""}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-semibold text-zinc-900">{money(bal)}</span>
                      {payingId !== b.id && <button onClick={() => startPay(b)} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Pay</button>}
                    </div>
                  </div>
                  {payingId === b.id && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3">
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 rounded-lg border border-zinc-300 px-2 py-1.5 text-right" />
                      <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm">
                        <option value="bank">Bank</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="other">Other</option>
                      </select>
                      <button onClick={() => pay(b)} disabled={busy} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy ? "Saving…" : "Record payment"}</button>
                      <button onClick={cancelPay} className="text-sm text-zinc-500 hover:underline">cancel</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-zinc-900">Recent payments</h2>
      {payments.length === 0 ? (
        <p className="mt-2 rounded-xl border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">No supplier payments yet.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2 text-sm last:border-0">
              <div className="min-w-0">
                <p className="truncate text-zinc-800">{p.expenses?.supplier || "—"} <span className="text-zinc-400">· {p.expenses?.expense_number ? expNo(p.expenses.expense_number) : ""}</span></p>
                <p className="text-xs text-zinc-400">{p.paid_date}{p.method ? " · " + p.method : ""}</p>
              </div>
              <span className="shrink-0 font-medium text-zinc-900">{money(p.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
