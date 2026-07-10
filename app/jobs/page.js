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
  const [problem, setProblem] = useState("");
  const [source, setSource] = useState("Phone");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  async function addJob(e) {
    e.preventDefault();
    if (!customerId || !machineId) { setError("Pick a customer and one of their machines."); return; }
    const todayNZ = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
    const { data: existing } = await supabase.from("job_cards").select("id").eq("machine_id", machineId).eq("job_date", todayNZ);
    if (existing && existing.length > 0) { setError("There's already a job card for this machine today."); return; }
    const { error } = await supabase.from("job_cards").insert({ customer_id: customerId, machine_id: machineId, reported_problem: problem, source });
    if (error) { setError(error.message); return; }
    setProblem(""); setMachineId(""); loadData();
  }

  async function updateStatus(jobId, status) {
    const { error } = await supabase.from("job_cards").update({ status }).eq("id", jobId);
    if (error) setError(error.message);
    else loadData();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Job cards</h1>
      <p className="mt-1 text-zinc-600">Every job, from first contact to paid.</p>

      <form onSubmit={addJob} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
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
          <Link href="/machines" title="Add a new machine" className="flex shrink-0 items-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50">+ New</Link>
        </div>
        <textarea value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What's the problem / what needs doing?" rows={2} className={input} />
        <select value={source} onChange={(e) => setSource(e.target.value)} className={input}>
          <option>Phone</option>
          <option>Website</option>
          <option>Walk-in</option>
        </select>
        <button type="submit" className={btn}>Create job card</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6 flex flex-col gap-3">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No job cards yet. Create one above.</p>
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
    </main>
  );
}
