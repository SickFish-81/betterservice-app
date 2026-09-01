"use client";

// One customer: their details, their machines, and what's been done to each.
//
// The machines live here rather than only under Machines, because the question
// people actually ask is "what has this customer got, and when was it last
// serviced" — not "show me every machine in the shop".

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useOwner } from "../../RoleContext";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const money = (n) => "$" + Number(n || 0).toFixed(2);
const nz = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-NZ") : "—");
const emptyMachine = { type: "ATV", make: "", model: "", vin: "", key_number: "" };

export default function CustomerPage() {
  const { id } = useParams();
  const owner = useOwner();
  const [customer, setCustomer] = useState(null);
  const [machines, setMachines] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [allMachines, setAllMachines] = useState([]);
  const [form, setForm] = useState(emptyMachine);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((v) => ({ ...v, [k]: e.target.value }));

  async function load() {
    setLoading(true);
    const [c, m, j, am] = await Promise.all([
      supabase.from("customers").select("*").eq("id", id).maybeSingle(),
      supabase.from("machines").select("*").eq("customer_id", id).order("created_at"),
      supabase.from("job_cards").select("*, invoices(invoice_number, total, status)").eq("customer_id", id).order("created_at", { ascending: false }),
      supabase.from("machines").select("type, make, model"),
    ]);
    const err = c.error || m.error || j.error || am.error;
    if (err) setError(err.message);
    else { setCustomer(c.data); setMachines(m.data || []); setJobs(j.data || []); setAllMachines(am.data || []); }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const opts = (field) => [...new Set(allMachines.map((x) => x[field]).filter(Boolean))].sort();

  function startEdit(m) {
    setEditingId(m.id);
    setAdding(false);
    setForm({ type: m.type || "", make: m.make || "", model: m.model || "", vin: m.vin || "", key_number: m.key_number || "" });
    setError(null);
  }
  function startAdd() {
    setAdding(true); setEditingId(null); setForm(emptyMachine); setError(null);
  }
  function cancel() { setAdding(false); setEditingId(null); setForm(emptyMachine); }

  async function saveMachine(e) {
    e.preventDefault();
    setError(null);
    if (!form.make.trim() && !form.model.trim()) return setError("Give the machine a make or model.");
    const payload = {
      customer_id: id,
      type: form.type.trim() || "ATV",
      make: form.make.trim(),
      model: form.model.trim(),
      vin: form.vin.trim() || null,
      key_number: form.key_number.trim() || null,
    };
    const { error } = editingId
      ? await supabase.from("machines").update(payload).eq("id", editingId)
      : await supabase.from("machines").insert(payload);
    if (error) { setError(error.message); return; }
    cancel();
    load();
  }

  // Jobs for one machine, newest first — the service history.
  const historyFor = (machineId) => jobs.filter((j) => j.machine_id === machineId);
  const unassigned = jobs.filter((j) => !j.machine_id);

  if (loading) return <main className="mx-auto max-w-3xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>;
  if (!customer) return <main className="mx-auto max-w-3xl px-4 py-8"><p className="text-zinc-600">That customer doesn&apos;t exist. <Link href="/customers" className="text-red-600 underline">Back to customers</Link></p></main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/customers" className="text-sm text-zinc-500 hover:text-zinc-800">← Customers</Link>

      <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">
        {customer.company_name || customer.name}
      </h1>
      <p className="mt-1 text-zinc-600">
        {customer.company_name && <>Attn: {customer.name} · </>}
        {[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details"}
      </p>
      {customer.address && <p className="text-sm text-zinc-500">{customer.address}</p>}

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-8 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-zinc-900">Machines</h2>
        <button onClick={() => (adding ? cancel() : startAdd())} className="text-sm text-zinc-600 underline hover:text-zinc-900">
          {adding ? "cancel" : "+ add a machine"}
        </button>
      </div>

      {(adding || editingId) && (
        <form onSubmit={saveMachine} className="mt-3 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-zinc-600">{editingId ? "Edit machine" : "New machine for this customer"}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input value={form.type} onChange={set("type")} list="c-types" placeholder="Type" className={input} />
            <input value={form.make} onChange={set("make")} list="c-makes" placeholder="Make" className={input} />
            <input value={form.model} onChange={set("model")} list="c-models" placeholder="Model" className={input} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={form.vin} onChange={set("vin")} placeholder="VIN / serial (optional)" className={input} />
            <input value={form.key_number} onChange={set("key_number")} placeholder="Key number (optional)" className={input} />
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700">
              {editingId ? "Save changes" : "Add machine"}
            </button>
            <button type="button" onClick={cancel} className="text-sm text-zinc-500 hover:underline">cancel</button>
          </div>
        </form>
      )}

      {machines.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">
          No machines recorded for this customer yet.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {machines.map((m) => {
            const history = historyFor(m.id);
            return (
              <div key={m.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-zinc-900">{[m.type, m.make, m.model].filter(Boolean).join(" ")}</p>
                    <p className="mt-0.5 text-sm text-zinc-500">
                      {[m.vin && `VIN ${m.vin}`, m.key_number && `Key ${m.key_number}`].filter(Boolean).join(" · ") || "No VIN or key recorded"}
                    </p>
                    {m.last_service_date && (
                      <p className="mt-0.5 text-sm text-zinc-500">Last service {nz(m.last_service_date)}</p>
                    )}
                  </div>
                  <button onClick={() => startEdit(m)} className="shrink-0 text-sm text-zinc-600 hover:underline">edit</button>
                </div>

                <div className="mt-3 border-t border-zinc-100 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Service history</p>
                  {history.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-500">Nothing on this machine yet.</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-zinc-100">
                      {history.map((j) => {
                        const inv = (j.invoices || [])[0];
                        return (
                          <li key={j.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                            <span className="min-w-0">
                              <Link href={`/jobs/${j.id}`} className="font-medium text-zinc-900 hover:text-red-700">Job #{j.job_number}</Link>
                              <span className="ml-2 text-zinc-500">{nz(j.job_date || j.created_at)}</span>
                              {j.reported_problem && <span className="ml-2 text-zinc-600">— {j.reported_problem}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="text-xs text-zinc-500">{j.status}</span>
                              {owner && inv && (
                                <span className="ml-2 font-medium text-zinc-800">{money(inv.total)}</span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {unassigned.length > 0 && (
        <>
          <h2 className="mt-8 font-semibold text-zinc-900">Jobs with no machine recorded</h2>
          <ul className="mt-2 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {unassigned.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <Link href={`/jobs/${j.id}`} className="font-medium text-zinc-900 hover:text-red-700">Job #{j.job_number}</Link>
                <span className="text-zinc-500">{nz(j.job_date || j.created_at)} · {j.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <datalist id="c-types">{opts("type").map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="c-makes">{opts("make").map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="c-models">{opts("model").map((x) => <option key={x} value={x} />)}</datalist>
    </main>
  );
}
