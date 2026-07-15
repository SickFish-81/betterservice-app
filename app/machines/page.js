"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const saveBtn = "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700";
const cancelBtn = "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50";

export default function MachinesPage() {
  const [machines, setMachines] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState("ATV");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [rego, setRego] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [ev, setEv] = useState({ customer_id: "", type: "ATV", make: "", model: "", rego: "" });

  async function loadData() {
    setLoading(true);
    const { data: m, error: mErr } = await supabase.from("machines").select("*, customers(name)").order("created_at", { ascending: false });
    const { data: c } = await supabase.from("customers").select("id, name").order("name");
    if (mErr) setError(mErr.message);
    else setMachines(m);
    setCustomers(c || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function addMachine(e) {
    e.preventDefault();
    if (!customerId) { setError("Pick a customer first."); return; }
    const { error } = await supabase.from("machines").insert({ customer_id: customerId, type, make, model, rego });
    if (error) { setError(error.message); return; }
    setMake(""); setModel(""); setRego(""); loadData();
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEv({ customer_id: m.customer_id || "", type: m.type || "ATV", make: m.make || "", model: m.model || "", rego: m.rego || "" });
    setError(null);
  }

  async function saveEdit(id) {
    if (!ev.customer_id) { setError("A machine needs an owner."); return; }
    const { error } = await supabase.from("machines").update({ customer_id: ev.customer_id, type: ev.type, make: ev.make, model: ev.model, rego: ev.rego }).eq("id", id);
    if (error) { setError(error.message); return; }
    setEditingId(null); loadData();
  }

  async function removeMachine(m) {
    if (!window.confirm(`Remove ${m.type} ${m.make} ${m.model}? This can't be undone.`)) return;
    const { error } = await supabase.from("machines").delete().eq("id", m.id);
    if (error) { setError("Couldn't remove that machine — it's still linked to job cards. Remove those jobs first."); return; }
    loadData();
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? machines.filter((m) => (m.type + " " + (m.make || "") + " " + (m.model || "") + " " + (m.rego || "") + " " + (m.customers?.name || "")).toLowerCase().includes(term))
    : machines;

  const makeOptions = [...new Set(machines.map((m) => m.make).filter(Boolean))].sort();
  const modelOptions = [...new Set(machines.map((m) => m.model).filter(Boolean))].sort();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Machines</h1>
      <p className="mt-1 text-zinc-600">Bikes &amp; ATVs, each linked to a customer.</p>

      <form onSubmit={addMachine} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={input}>
          <option value="">Select customer…</option>
          {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
          <option>ATV</option>
          <option>Motorcycle</option>
          <option>Other</option>
        </select>
        <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make (pick or type new)" list="make-options" className={input} />
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model (pick or type new)" list="model-options" className={input} />
        <input value={rego} onChange={(e) => setRego(e.target.value)} placeholder="Rego / plate" className={input} />
        <button type="submit" className={btn}>Add machine</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search machines by make, model, rego or owner…" className={input} />
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : machines.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No machines yet. Add one above.</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No machines match "{q}".</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {shown.map((m) => (
              <li key={m.id} className="p-4">
                {editingId === m.id ? (
                  <div className="flex flex-col gap-2">
                    <select value={ev.customer_id} onChange={(e) => setEv({ ...ev, customer_id: e.target.value })} className={input}>
                      <option value="">Select customer…</option>
                      {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                    <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })} className={input}>
                      <option>ATV</option>
                      <option>Motorcycle</option>
                      <option>Other</option>
                    </select>
                    <input value={ev.make} onChange={(e) => setEv({ ...ev, make: e.target.value })} placeholder="Make" list="make-options" className={input} />
                    <input value={ev.model} onChange={(e) => setEv({ ...ev, model: e.target.value })} placeholder="Model" list="model-options" className={input} />
                    <input value={ev.rego} onChange={(e) => setEv({ ...ev, rego: e.target.value })} placeholder="Rego / plate" className={input} />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(m.id)} className={saveBtn}>Save</button>
                      <button onClick={() => setEditingId(null)} className={cancelBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-900">{m.type} — {m.make} {m.model}</p>
                      <p className="truncate text-sm text-zinc-500">{[m.rego, m.customers?.name].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="flex shrink-0 gap-3 text-sm">
                      <button onClick={() => startEdit(m)} className="font-medium text-red-600 hover:text-red-700">edit</button>
                      <button onClick={() => removeMachine(m)} className="text-zinc-500 hover:text-red-600">remove</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <datalist id="make-options">{makeOptions.map((x) => (<option key={x} value={x} />))}</datalist>
      <datalist id="model-options">{modelOptions.map((x) => (<option key={x} value={x} />))}</datalist>
    </main>
  );
}
