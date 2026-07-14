'use client';

// Betterservice — Expenses screen (Phase 2a)
// Records a cost in the `expenses` table; a database trigger posts the
// balanced journal automatically (DR expense + DR GST / CR Bank or Payables),
// so account 200 GST nets correctly against GST collected on sales.

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const GST_RATE = 0.15; // NZ GST
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function ExpensesPage() {
  const [accounts, setAccounts] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const emptyForm = {
    expense_date: today,
    supplier: '',
    description: '',
    account_id: '',
    amount_ex_gst: '',
    gstMode: 'standard', // 'standard' = 15%, 'none' = no GST, 'manual' = type it
    gst: '',
    paid_on_account: false,
    method: 'bank',
  };
  const [form, setForm] = useState(emptyForm);
  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const amountEx = Number(form.amount_ex_gst) || 0;
  const gstValue =
    form.gstMode === 'none' ? 0 :
    form.gstMode === 'manual' ? round2(form.gst) :
    round2(amountEx * GST_RATE);
  const total = round2(amountEx + gstValue);

  async function loadAll() {
    setLoading(true);
    const { data: acc } = await supabase
      .from('accounts')
      .select('id, code, name, type')
      .eq('type', 'expense')
      .order('code');
    setAccounts(acc || []);

    const { data: exp } = await supabase
      .from('expenses')
      .select(
        'id, expense_number, expense_date, supplier, description, amount_ex_gst, gst, total, paid_on_account, status, account:accounts(code, name)'
      )
      .order('created_at', { ascending: false })
      .limit(50);
    setExpenses(exp || []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!form.account_id) return setError('Pick a category.');
    if (amountEx <= 0) return setError('Enter an amount greater than zero.');

    setSaving(true);
    const { error: insErr } = await supabase.from('expenses').insert({
      expense_date: form.expense_date,
      supplier: form.supplier || null,
      description: form.description || null,
      account_id: form.account_id,
      amount_ex_gst: amountEx,
      gst: gstValue,
      gst_claimable: form.gstMode !== 'none',
      paid_on_account: form.paid_on_account,
      method: form.method || null,
      status: form.paid_on_account ? 'Unpaid' : 'Paid',
    });
    setSaving(false);

    if (insErr) return setError(insErr.message);
    setOk('Expense saved and posted to the ledger.');
    setForm(emptyForm);
    loadAll();
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
      <p className="mt-1 text-sm text-gray-500">
        Record a cost. The books update automatically, and GST paid on purchases is
        offset against GST collected on sales.
      </p>

      {/* Entry form */}
      <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Date</span>
            <input type="date" value={form.expense_date} onChange={set('expense_date')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Supplier</span>
            <input type="text" value={form.supplier} onChange={set('supplier')} placeholder="e.g. Repco"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-gray-700">What was it for?</span>
            <input type="text" value={form.description} onChange={set('description')} placeholder="e.g. Workshop consumables"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Category</span>
            <select value={form.account_id} onChange={set('account_id')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2">
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Amount (excl. GST)</span>
            <input type="number" step="0.01" min="0" inputMode="decimal"
              value={form.amount_ex_gst} onChange={set('amount_ex_gst')} placeholder="0.00"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">GST</span>
            <select value={form.gstMode} onChange={set('gstMode')}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2">
              <option value="standard">Standard 15%</option>
              <option value="none">No GST (wages, bank fees, unregistered supplier)</option>
              <option value="manual">Enter manually</option>
            </select>
          </label>

          {form.gstMode === 'manual' && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">GST amount</span>
              <input type="number" step="0.01" min="0" inputMode="decimal"
                value={form.gst} onChange={set('gst')} placeholder="0.00"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Payment</span>
            <select value={form.paid_on_account ? 'account' : 'bank'}
              onChange={(e) => setForm((f) => ({ ...f, paid_on_account: e.target.value === 'account' }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2">
              <option value="bank">Paid now (from bank)</option>
              <option value="account">On account (pay supplier later)</option>
            </select>
          </label>
        </div>

        {/* Live totals */}
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm text-gray-600">
          <span>Net: <strong>{money(amountEx)}</strong></span>
          <span>GST: <strong>{money(gstValue)}</strong></span>
          <span>Total: <strong className="text-gray-900">{money(total)}</strong></span>
        </div>

        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {ok && <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}

        <button type="submit" disabled={saving}
          className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save expense'}
        </button>
      </form>

      {/* Recent expenses */}
      <h2 className="mt-8 text-lg font-semibold text-gray-900">Recent expenses</h2>
      {loading ? (
        <p className="mt-3 text-sm text-gray-500">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No expenses recorded yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Net</th>
                <th className="px-3 py-2 text-right font-medium">GST</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenses.map((x) => (
                <tr key={x.id}>
                  <td className="px-3 py-2 text-gray-500">EXP-{String(x.expense_number).padStart(5, '0')}</td>
                  <td className="px-3 py-2">{x.expense_date}</td>
                  <td className="px-3 py-2">{x.supplier || '—'}</td>
                  <td className="px-3 py-2">{x.account ? `${x.account.code} · ${x.account.name}` : '—'}</td>
                  <td className="px-3 py-2 text-right">{money(x.amount_ex_gst)}</td>
                  <td className="px-3 py-2 text-right">{money(x.gst)}</td>
                  <td className="px-3 py-2 text-right font-medium">{money(x.total)}</td>
                  <td className="px-3 py-2">{x.paid_on_account ? (x.status || 'Unpaid') : 'Paid'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
