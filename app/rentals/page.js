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
import Hireage from "./Hireage";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const gstOf = (inc) => Math.round(Number(inc || 0) * 3 / 23 * 100) / 100;
const nzDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ") : "");

const empty = { unit_id: "", customer_id: "", monthly_rate_incl_gst: "", power_charge_incl_gst: "", start_date: "", end_date: "", on_hold: false, notes: "" };

export default function RentalsPage() {
  const [units, setUnits] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("units");
  const [newUnit, setNewUnit] = useState({ name: "", description: "" });
  const [addingUnit, setAddingUnit] = useState(false);
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

  // The tenancy that matters for a unit: the one running today, or if none has
  // started yet, the next one due. A tenancy signed for next month is NOT a
  // vacant unit — showing it as vacant is how a unit gets double-let.
  const today = new Date().toISOString().slice(0, 10);
  const currentFor = (unitId) => {
    const live = agreements
      .filter((a) => a.unit_id === unitId && (!a.end_date || a.end_date >= today))
      .sort((x, y) => String(x.start_date).localeCompare(String(y.start_date)));
    return live.find((a) => a.start_date <= today) || live[0] || null;
  };

  function startEdit(a) {
    setEditingId(a.id);
    setForm({
      unit_id: a.unit_id, customer_id: a.customer_id,
      monthly_rate_incl_gst: String(a.monthly_rate_incl_gst ?? ""),
      power_charge_incl_gst: a.power_charge_incl_gst ? String(a.power_charge_incl_gst) : "",
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
    const power = form.power_charge_incl_gst === "" ? 0 : Number(form.power_charge_incl_gst);
    if (!Number.isFinite(power) || power < 0) return setError("Power charge must be a number, or leave it blank.");
    if (!form.start_date) return setError("Enter the date the tenancy starts.");
    if (form.end_date && form.end_date < form.start_date) return setError("The end date can't be before the start date.");

    const payload = {
      unit_id: form.unit_id,
      customer_id: form.customer_id,
      monthly_rate_incl_gst: rate,
      power_charge_incl_gst: Number(form.power_charge_incl_gst) || 0,
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

  async function addUnit(e) {
    e.preventDefault();
    setError(null);
    const name = newUnit.name.trim();
    if (!name) return setError("Give the unit a name.");
    const { error } = await supabase.from("rental_units")
      .insert({ name, description: newUnit.description.trim() || null });
    if (error) {
      setError(error.message.includes("duplicate") || error.message.includes("unique")
        ? `There's already a unit called "${name}".`
        : error.message);
      return;
    }
    setNewUnit({ name: "", description: "" });
    setAddingUnit(false);
    load();
  }

  // Retiring a unit keeps its history — the tenancies and invoices that ran
  // through it stay exactly where they are, it just stops being offered.
  async function toggleUnitActive(u) {
    const { error } = await supabase.from("rental_units").update({ active: !u.active }).eq("id", u.id);
    if (error) setError(error.message);
    load();
  }

  async function toggleHold(a) {
    const { error } = await supabase.from("rental_agreements").update({ on_hold: !a.on_hold }).eq("id", a.id);
    if (error) setError(error.message);
    load();
  }

  const rate = Number(form.monthly_rate_incl_gst) || 0;
  const powerAmt = Number(form.power_charge_incl_gst) || 0;
  const billTotal = rate + powerAmt;
  const gst = billTotal > 0 ? gstOf(billTotal) : 0;
  const vacant = units.filter((u) => !currentFor(u.id)).length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Rentals</h1>
      <p className="mt-1 text-zinc-600">
        {tab === "units"
          ? "The storage units and the shed. Rent is invoiced automatically three days before each month starts, due on the 1st."
          : "Gear hired out by the day. Paid when it goes out or comes back, not on account."}
      </p>

      <div className="mt-5 flex gap-1 border-b border-zinc-200">
        {[["units", "Storage units"], ["hireage", "Hireage"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={"-mb-px border-b-2 px-4 py-2 text-sm font-medium " +
              (tab === k ? "border-red-600 text-red-700" : "border-transparent text-zinc-500 hover:text-zinc-800")}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "hireage" && <Hireage />}
      {tab === "units" && (
      <>

      <form onSubmit={save} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-zinc-900">{editingId ? "Edit tenancy" : "New tenancy"}</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select value={form.unit_id} onChange={set("unit_id")} className={input}>
            <option value="">Which unit…</option>
            {units.filter((u) => u.active || u.id === form.unit_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={form.customer_id} onChange={set("customer_id")} className={input}>
            <option value="">Which tenant…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <p className="-mt-1 text-xs text-zinc-500">
          Tenant not listed? <Link href="/customers" className="underline hover:text-zinc-700">Add them under Customers</Link> first.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-zinc-600">Monthly rent (GST inclusive)
            <input value={form.monthly_rate_incl_gst} onChange={set("monthly_rate_incl_gst")} type="number" step="0.01" min="0"
                   placeholder="what the tenant pays" className={input} />
          </label>
          <label className="text-xs font-medium text-zinc-600">Power each month (GST inclusive, optional)
            <input value={form.power_charge_incl_gst} onChange={set("power_charge_incl_gst")} type="number" step="0.01" min="0"
                   placeholder="leave blank if none" className={input} />
          </label>
        </div>
        {billTotal > 0 && (
          <p className="-mt-1 text-xs text-zinc-500">
            Invoiced each month: {money(billTotal - gst)} + {money(gst)} GST = <span className="font-medium text-zinc-700">{money(billTotal)}</span>
            {powerAmt > 0 && <> · shown as two lines, rent {money(rate)} and power {money(powerAmt)}</>}
          </p>
        )}

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
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-zinc-900">The units</h2>
          <div className="flex items-baseline gap-3">
            <p className="text-sm text-zinc-500">{units.length - vacant} let · {vacant} vacant</p>
            <button onClick={() => { setAddingUnit((v) => !v); setError(null); }} className="text-sm text-zinc-600 underline hover:text-zinc-900">
              {addingUnit ? "cancel" : "+ add a unit"}
            </button>
          </div>
        </div>

        {addingUnit && (
          <form onSubmit={addUnit} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-zinc-600">Name
              <input value={newUnit.name} onChange={(e) => setNewUnit((v) => ({ ...v, name: e.target.value }))}
                     placeholder="e.g. Unit 11, Sign Space" className={input} />
            </label>
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-zinc-600">Description
              <input value={newUnit.description} onChange={(e) => setNewUnit((v) => ({ ...v, description: e.target.value }))}
                     placeholder="optional" className={input} />
            </label>
            <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">Add unit</button>
          </form>
        )}

        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {units.map((u) => {
              const a = currentFor(u.id);
              const upcoming = !!a && a.start_date > today;
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">
                      {u.name}
                      {a && <span className="text-zinc-400"> · </span>}
                      {a && <span>{a.customers?.company_name || a.customers?.name || "—"}</span>}
                      {a?.on_hold && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">on hold</span>}
                      {upcoming && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">from {nzDate(a.start_date)}</span>}
                      {!a && u.active && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">vacant</span>}
                      {!u.active && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-600">retired</span>}
                    </p>
                    <p className="truncate text-sm text-zinc-500">
                      {a
                        ? `${a.customers?.company_name ? a.customers?.name + " · " : ""}${money(Number(a.monthly_rate_incl_gst) + Number(a.power_charge_incl_gst || 0))}/month${Number(a.power_charge_incl_gst) > 0 ? ` (incl ${money(a.power_charge_incl_gst)} power)` : ""} · ${upcoming ? "starts" : "since"} ${nzDate(a.start_date)} · ${a.end_date ? "ends " + nzDate(a.end_date) : "open-ended"}`
                        : "No tenant"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    {a && <button onClick={() => startEdit(a)} className="text-zinc-600 hover:underline">edit</button>}
                    {a && <button onClick={() => toggleHold(a)} className="text-zinc-600 hover:underline">{a.on_hold ? "resume" : "hold"}</button>}
                    {a && <button onClick={() => removeAgreement(a)} className="text-red-500 hover:underline">remove</button>}
                    {!a && <button onClick={() => toggleUnitActive(u)} className="text-zinc-600 hover:underline">{u.active ? "retire" : "reinstate"}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      </>
      )}
    </main>
  );
}
