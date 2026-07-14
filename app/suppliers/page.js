"use client";

// Betterservice — Suppliers (Phase 3a)
// A simple supplier list to attach to parts and reorder from.

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

const empty = { name: "", contact_name: "", phone: "", email: "", notes: "" };

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("suppliers").select("*").order("name");
    if (error) setError(error.message);
    else setSuppliers(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function startEdit(s) {
    setEditingId(s.id);
    setForm({ name: s.name || "", contact_name: s.contact_name || "", phone: s.phone || "", email: s.email || "", notes: s.notes || "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelEdit() { setEditingId(null); setForm(empty); }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Give the supplier a name.");
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      notes: form.notes || null,
    };
    const { error } = editingId
      ? await supabase.from("suppliers").update(payload).eq("id", editingId)
      : await supabase.from("suppliers").insert(payload);
    if (error) { setError(error.message); return; }
    cancelEdit();
    load();
  }

  async function toggleActive(s) {
    await supabase.from("suppliers").update({ is_active: !s.is_active }).eq("id", s.id);
    load();
  }
  async function remove(id) {
    if (!window.confirm("Remove this supplier? Parts linked to it will just lose the link.")) return;
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    load();
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? suppliers.filter((s) => (s.name + " " + (s.contact_name || "") + " " + (s.email || "")).toLowerCase().includes(term))
    : suppliers;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Suppliers</h1>
      <p className="mt-1 text-zinc-600">Who you buy parts from. Link these to parts, then use the reorder report on the Parts page.</p>

      <form onSubmit={save} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={form.name} onChange={set("name")} placeholder="Supplier name (e.g. Repco)" className={input} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input value={form.contact_name} onChange={set("contact_name")} placeholder="Contact person (optional)" className={input} />
          <input value={form.phone} onChange={set("phone")} type="tel" placeholder="Phone (optional)" className={input} />
        </div>
        <input value={form.email} onChange={set("email")} type="email" placeholder="Email (optional)" className={input} />
        <input value={form.notes} onChange={set("notes")} placeholder="Notes (optional)" className={input} />
        <div className="flex items-center gap-3">
          <button type="submit" className={btn}>{editingId ? "Save changes" : "Add supplier"}</button>
          {editingId && <button type="button" onClick={cancelEdit} className="text-sm text-zinc-500 hover:underline">cancel</button>}
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search suppliers…" className={input} />
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : suppliers.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No suppliers yet. Add your first one above.</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No suppliers match "{q}".</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">
                    {s.name}
                    {!s.is_active && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">inactive</span>}
                  </p>
                  <p className="truncate text-sm text-zinc-500">
                    {[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <button onClick={() => startEdit(s)} className="text-zinc-600 hover:underline">edit</button>
                  <button onClick={() => toggleActive(s)} className="text-zinc-600 hover:underline">{s.is_active ? "deactivate" : "reactivate"}</button>
                  <button onClick={() => remove(s.id)} className="text-red-500 hover:underline">remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
