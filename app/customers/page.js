"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const saveBtn = "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700";
const cancelBtn = "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50";

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [ev, setEv] = useState({ name: "", phone: "", email: "", address: "", company_name: "", no_reminders: false });

  async function loadCustomers() {
    setLoading(true);
    const { data, error } = await supabase.from("customers").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setCustomers(data);
    setLoading(false);
  }

  useEffect(() => { loadCustomers(); }, []);

  async function addCustomer(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("customers").insert({ name, phone, email, address, company_name: company || null });
    if (error) { setError(error.message); return; }
    setName(""); setPhone(""); setEmail(""); setAddress(""); setCompany(""); loadCustomers();
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEv({ name: c.name || "", phone: c.phone || "", email: c.email || "", address: c.address || "", company_name: c.company_name || "", no_reminders: !!c.no_reminders });
    setError(null);
  }

  async function saveEdit(id) {
    if (!ev.name.trim()) { setError("Name can't be blank."); return; }
    const { error } = await supabase.from("customers").update({ name: ev.name, phone: ev.phone, email: ev.email, address: ev.address, company_name: ev.company_name || null, no_reminders: ev.no_reminders }).eq("id", id);
    if (error) { setError(error.message); return; }
    setEditingId(null); loadCustomers();
  }

  async function removeCustomer(c) {
    if (!window.confirm(`Remove ${c.name}? This can't be undone.`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", c.id);
    if (error) { setError(`Couldn't remove ${c.name} — they're still linked to machines or job cards. Remove those first.`); return; }
    loadCustomers();
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? customers.filter((c) => (c.name + " " + (c.phone || "") + " " + (c.email || "") + " " + (c.address || "")).toLowerCase().includes(term))
    : customers;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Customers</h1>
      <p className="mt-1 text-zinc-600">The people Betterservice serves.</p>

      <form onSubmit={addCustomer} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Phone" className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" className={input} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address (for pickup / delivery)" className={input} />
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company charged (leave blank to charge this person)" className={input} />
        <button type="submit" className={btn}>Add customer</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers by name, phone, email or address…" className={input} />
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : customers.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No customers yet. Add your first one above.</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No customers match "{q}".</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {shown.map((c) => (
              <li key={c.id} className="p-4">
                {editingId === c.id ? (
                  <div className="flex flex-col gap-2">
                    <input value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} placeholder="Name" className={input} />
                    <input value={ev.phone} onChange={(e) => setEv({ ...ev, phone: e.target.value })} type="tel" placeholder="Phone" className={input} />
                    <input value={ev.email} onChange={(e) => setEv({ ...ev, email: e.target.value })} type="email" placeholder="Email" className={input} />
                    <input value={ev.address} onChange={(e) => setEv({ ...ev, address: e.target.value })} placeholder="Address (for pickup / delivery)" className={input} />
                    <input value={ev.company_name} onChange={(e) => setEv({ ...ev, company_name: e.target.value })} placeholder="Company charged (leave blank to charge this person)" className={input} />
                    <label className="flex items-center gap-2 py-1 text-sm text-zinc-700"><input type="checkbox" checked={!ev.no_reminders} onChange={(e) => setEv({ ...ev, no_reminders: !e.target.checked })} className="h-4 w-4 rounded border-zinc-300 accent-red-600" /> Send service reminders</label>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(c.id)} className={saveBtn}>Save</button>
                      <button onClick={() => setEditingId(null)} className={cancelBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/customers/${c.id}`} className="font-medium text-zinc-900 hover:text-red-700">{c.name}</Link>
                      {c.company_name && <p className="text-sm text-zinc-500">{c.company_name}</p>}
                      <p className="truncate text-sm text-zinc-500">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
                      {c.address && <p className="truncate text-sm text-zinc-500">{c.address}</p>}
                      {c.no_reminders && <p className="mt-0.5 text-xs font-medium text-amber-600">Reminders off</p>}
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm">
                      <Link href={`/customers/${c.id}`} className="text-zinc-600 hover:text-zinc-900">machines</Link>
                      <button onClick={() => startEdit(c)} className="font-medium text-red-600 hover:text-red-700">edit</button>
                      <button onClick={() => removeCustomer(c)} className="text-zinc-500 hover:text-red-600">remove</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
