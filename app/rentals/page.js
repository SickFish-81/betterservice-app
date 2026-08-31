"use client";

// Betterservice — Rentals
// The ten small units and the large shed, and who is in each one.
//
// The rent held here is what the tenant actually pays: GST-INCLUSIVE, because
// that is what their automatic payment is set to. The invoice generator
// extracts the GST at 3/23 rather than adding 15% on top — the opposite of a
// job card, where prices are held ex-GST. The split is shown live under the
// rent box so there is no guessing about which number goes in.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const gstOf = (inc) => Math.round(Number(inc || 0) * 3 / 23 * 100) / 100;
const nzDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ") : "");

const empty = { unit_id: "", customer_id: "", monthly_rate_incl_gst: "", start_date: "", end_date: "", on_hold: false, notes: "" };

export default function RentalsPage() {
  const [units, setUnits] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function load() {
    setLoading(true);
    const [u, a, c] = await Promise.all([
      supabase.from("rental_units").select("*").order("name"),
      supabase.from("rental_agreements").select("*, customers(name), rental_units(name)"),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    if (u.error || a.error || c.error) setError((u.error || a.error || c.error).message);
    else { setUnits(u.data || []); setAgreements(a.data || []); setCustomers(c.data || []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // The agreement that covers today, if any. An agreement with no end date runs on.
  const today = new Date().toISOString().slice(0, 10);
  const currentFor = (unitId) =>
    agreements.find((a) => a.unit_id === unitId && a.start_date <= today && (!a.end_date || a.end_date >= today));

  function startEdit(a) {
    setEditingId(a.id);
    setForm({
      unit_id: a.unit_id, customer_id: a.customer_id,
      monthly_rate_incl_gst: String(a.monthly_rate_incl_gst ?? ""),
      start_date: a.start_date || "", end_date: a.end_date || "",
      on_hold: !!a.on_hold, notes: a.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelEdit() { setEditingId(null); setForm(empty); }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (!form.unit_id) return setError("Pick a unit.");
    if (!form.customer_id) return setError("Pick the tenant. Add them under Customers first if they're not listed.");
    const rate = Number(form.monthly_rate_incl_gst);
    if (!(rate > 0)) return setError("Enter the monthly rent the tenant pays.");
    if (!form.start_date) return setError("Enter the date the tenancy starts.");
    if (form.end_date && form.end_date < form.start_date) return setError("The end date can't be before the start date.");

    const payload = {
      unit_id: form.unit_id,
      customer_id: form.customer_id,
      monthly_rate_incl_gst: rate,
      start_date: form.start_date,
      end_date: form.end_date || null,
      on_hold: !!form.on_hold,
      notes: form.notes || null,
    };
    const { error } = editingId
      ? await supabase.from("rental_agreements").update(payload).eq("id", editingId)
      : await supabase.from("rental_agreements").insert(payload);
    if (error) { setError(error.message); return; }
    cancelEdit();
    load();
  }

  // Only for a tenancy entered by mistake. One that has ever been invoiced is
  // refused by the database — its invoices point at it, and deleting it would
  // orphan them. End-date it instead.
  async function removeAgreement(a) {
    if (!window.confirm(`Delete this tenancy for ${a.rental_units?.name || "this unit"}?\n\nUse this only for a mistake. To end a real tenancy, set an end date instead so the history is kept.`)) return;
    const { error } = await supabase.from("rental_agreements").delete().eq("id", a.id);
    if (error) {
      setError(error.message.includes("foreign key") || error.message.includes("violates")
        ? "This tenancy has invoices against it, so it can't be deleted. Set an end date instead."
        : error.message);
      return;
    }
    setError(null);
    load();
  }

  async function toggleHold(a) {
    const { error } = await supabase.from("rental_agreements").update({ on_hold: !a.on_hold }).eq("id", a.id);
    if (error) setError(error.message);
    load();
  }

  const rate = Number(form.monthly_rate_incl_gst);
  const gst = rate > 0 ? gstOf(rate) : 0;
  const vacant = units.filter((u) => !currentFor(u.id)).length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Rentals</h1>
      <p className="mt-1 text-zinc-600">
        The storage units and the shed. Rent is invoiced automatically three days before each month starts,
        due on the 1st.
      </p>

      <form onSubmit={save} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-zinc-900">{editingId ? "Edit tenancy" : "New tenancy"}</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select value={form.unit_id} onChange={set("unit_id")} className={input}>
            <option value="">Which unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={form.customer_id} onChange={set("customer_id")} className={input}>
            <option value="">Which tenant…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <p className="-mt-1 text-xs text-zinc-500">
          Tenant not listed? <Link href="/customers" className="underline hover:text-zinc-700">Add them under Customers</Link> first.
        </p>

        <div>
          <input value={form.monthly_rate_incl_gst} onChange={set("monthly_rate_incl_gst")} type="number" step="0.01" min="0"
                 placeholder="Monthly rent the tenant pays (GST inclusive)" className={input} />
          {rate > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              Invoice will read {money(rate - gst)} + {money(gst)} GST = <span className="font-medium text-zinc-700">{money(rate)}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-600">Starts
            <input value={form.start_date} onChange={set("start_date")} type="date" className={input} />
          </label>
          <label className="text-sm text-zinc-600">Ends (leave blank if ongoing)
            <input value={form.end_date} onChange={set("end_date")} type="date" className={input} />
          </label>
        </div>

        <input value={form.notes} onChange={set("notes")} placeholder="Notes (optional)" className={input} />

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={form.on_hold} onChange={(e) => setForm((f) => ({ ...f, on_hold: e.target.checked }))} />
          On hold — don&apos;t invoice this one for now
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className={btn}>{editingId ? "Save changes" : "Add tenancy"}</button>
          {editingId && <button type="button" onClick={cancelEdit} className="text-sm text-zinc-500 hover:underline">cancel</button>}
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold text-zinc-900">The units</h2>
          <p className="text-sm text-zinc-500">{units.length - vacant} let · {vacant} vacant</p>
        </div>

        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {units.map((u) => {
              const a = currentFor(u.id);
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">
                      {u.name}
                      {a?.on_hold && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">on hold</span>}
                      {!a && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">vacant</span>}
                    </p>
                    <p className="truncate text-sm text-zinc-500">
                      {a
                        ? `${a.customers?.name || "—"} · ${money(a.monthly_rate_incl_gst)}/month · since ${nzDate(a.start_date)}${a.end_date ? ` · ends ${nzDate(a.end_date)}` : ""}`
                        : "No tenant"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    {a && <button onClick={() => startEdit(a)} className="text-zinc-600 hover:underline">edit</button>}
                    {a && <button onClick={() => toggleHold(a)} className="text-zinc-600 hover:underline">{a.on_hold ? "resume" : "hold"}</button>}
                    {a && <button onClick={() => removeAgreement(a)} className="text-red-500 hover:underline">remove</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
