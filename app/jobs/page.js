"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const STATUSES = ["New", "In progress", "Awaiting parts", "Ready", "Invoiced", "Paid"];
const STATUS_STYLES = {
  "New": "bg-blue-50 text-blue-700",
  "In progress": "bg-amber-50 text-amber-700",
  "Awaiting parts": "bg-orange-50 text-orange-700",
  "Ready": "bg-violet-50 text-violet-700",
  "Invoiced": "bg-zinc-100 text-zinc-700",
  "Paid": "bg-emerald-50 text-emerald-700",
};
const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [addingMachine, setAddingMachine] = useState(false);
  const [nmType, setNmType] = useState("ATV");
  const [nmMake, setNmMake] = useState("");
  const [nmModel, setNmModel] = useState("");
  const [problem, setProblem] = useState("");
  const [source, setSource] = useState("Phone");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);

  async function loadData() {
    setLoading(true);
    const { data: j, error: jErr } = await supabase.from("job_cards").select("*, customers(name), machines(type, make, model)").order("created_at", { ascending: false });
    const { data: c } = await supabase.from("customers").select("id, name").order("name");
    const { data: m } = await supabase.from("machines").select("id, customer_id, type, make, model");
    if (jErr) setError(jErr.message);
    else setJobs(j);
    setCustomers(c || []);
    setMachines(m || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const machinesForCustomer = machines.filter((m) => m.customer_id === customerId);

  // A customer turning up with a bike that isn't on file used to mean leaving
  // this page, adding it under Machines, and starting the job card again. Add
  // it here instead, and select it.
  async function addMachineInline() {
    if (!customerId) { setError("Pick a customer first."); return; }
    if (!nmMake.trim() && !nmModel.trim()) { setError("Give the machine a make or model."); return; }
    const { data, error } = await supabase
      .from("machines")
      .insert({ customer_id: customerId, type: nmType.trim() || "ATV", make: nmMake.trim(), model: nmModel.trim() })
      .select("id, customer_id, type, make, model")
      .single();
    if (error) { setError(error.message); return; }
    setMachines((prev) => [...prev, data]);
    setMachineId(data.id);
    setNmMake(""); setNmModel(""); setAddingMachine(false); setError(null);
  }


  async function addJob(e) {
    e.preventDefault();
    if (!customerId || !machineId) { setError("Pick a customer and one of their machines."); return; }
    const todayNZ = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
    const { data: existing } = await supabase.from("job_cards").select("id").eq("machine_id", machineId).eq("job_date", todayNZ);
    if (existing && existing.length > 0) { setError("There's already a job card for this machine today."); return; }
    const { error } = await supabase.from("job_cards").insert({ customer_id: customerId, machine_id: machineId, reported_problem: problem, source });
    if (error) { setError(error.message); return; }
    setProblem(""); setMachineId(""); setCustomerId(""); setShowNew(false); loadData();
  }

  async function updateStatus(jobId, status) {
    const { error } = await supabase.from("job_cards").update({ status }).eq("id", jobId);
    if (error) setError(error.message);
    else loadData();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Job Cards</h1>
          <p className="mt-1 text-zinc-600">Every job, from first contact to paid.</p>
        </div>
        <button onClick={() => { setError(null); setShowNew(true); }} className={btn + " shrink-0 whitespace-nowrap"}>+ New job card</button>
      </div>

      {error && !showNew && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6 flex flex-col gap-3">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No job cards yet. Tap “+ New job card” to start one.</p>
        ) : (
          jobs.map((j) => (
            <div key={j.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300">
              <div className="flex items-center justify-between gap-3">
                <Link href={`/jobs/${j.id}`} className="text-lg font-semibold text-zinc-900 hover:text-red-700">Job #{j.job_number}</Link>
                <select value={j.status} onChange={(e) => updateStatus(j.id, e.target.value)} className={`rounded-full border-0 px-3 py-1 text-sm font-medium ${STATUS_STYLES[j.status] || "bg-zinc-100 text-zinc-700"}`}>
                  {STATUSES.map((s) => (<option key={s}>{s}</option>))}
                </select>
              </div>
              <p className="mt-1 text-sm text-zinc-700">{j.customers?.name} · {j.machines?.type} {j.machines?.make} {j.machines?.model}</p>
              {j.reported_problem && <p className="mt-1 text-sm text-zinc-500">{j.reported_problem}</p>}
              <div className="mt-3">
                <Link href={`/jobs/${j.id}`} className="text-sm font-medium text-red-600 hover:text-red-700">Open →</Link>
              </div>
            </div>
          ))
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">New job card</h2>
              <button onClick={() => setShowNew(false)} aria-label="Close" className="rounded-md p-1 text-2xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">×</button>
            </div>
            <form onSubmit={addJob} className="mt-4 flex flex-col gap-3">
              <div className="flex gap-2">
                <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setMachineId(""); }} className={input + " flex-1"}>
                  <option value="">Select customer…</option>
                  {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                </select>
                <Link href="/customers" title="Add a new customer" className="flex shrink-0 items-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">+ New</Link>
              </div>
              <div className="flex gap-2">
                <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className={input + " flex-1"} disabled={!customerId}>
                  <option value="">{customerId ? "Select machine…" : "Pick a customer first"}</option>
                  {machinesForCustomer.map((m) => (<option key={m.id} value={m.id}>{m.type} — {m.make} {m.model}</option>))}
                </select>
                <button type="button" onClick={() => { setAddingMachine((v) => !v); setError(null); }} disabled={!customerId} title="Add a new machine for this customer" className="flex shrink-0 items-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">{addingMachine ? "cancel" : "+ New"}</button>
              </div>
              {addingMachine && customerId && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <p className="mb-2 text-xs font-medium text-zinc-600">New machine for this customer</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input value={nmType} onChange={(e) => setNmType(e.target.value)} placeholder="Type" list="nm-types" className={input} />
                    <input value={nmMake} onChange={(e) => setNmMake(e.target.value)} placeholder="Make" list="nm-makes" className={input} />
                    <input value={nmModel} onChange={(e) => setNmModel(e.target.value)} placeholder="Model" list="nm-models" className={input} />
                  </div>
                  <datalist id="nm-types">{[...new Set(machines.map((m) => m.type).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="nm-makes">{[...new Set(machines.map((m) => m.make).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
                  <datalist id="nm-models">{[...new Set(machines.map((m) => m.model).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
                  <button type="button" onClick={addMachineInline} className="mt-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">Add machine</button>
                </div>
              )}
              <textarea value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What's the problem / what needs doing?" rows={2} className={input} />
              <select value={source} onChange={(e) => setSource(e.target.value)} className={input}>
                <option>Phone</option>
                <option>Website</option>
                <option>Walk-in</option>
              </select>
              {error && <p className="text-sm text-red-600">Error: {error}</p>}
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50">Cancel</button>
                <button type="submit" className={btn + " flex-1"}>Create job card</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
