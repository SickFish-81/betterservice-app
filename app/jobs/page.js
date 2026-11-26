"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const STATUS_STYLES = {
  "New": "bg-blue-50 text-blue-700",
  "In progress": "bg-amber-50 text-amber-700",
  "Awaiting parts": "bg-orange-50 text-orange-700",
  "Presale": "bg-sky-50 text-sky-700",
  "Ready": "bg-violet-50 text-violet-700",
  "Invoiced": "bg-zinc-100 text-zinc-700",
  "Paid": "bg-emerald-50 text-emerald-700",
};
// Once a job is invoiced or paid it's finished. It stays on the list for
// history, but collapsed to one line so the workshop only sees live work.
const DONE = new Set(["Invoiced", "Paid"]);

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

// "Ready" reads as "waiting for Craig" on the list, which is what it means.
const statusLabel = (st) => (st === "Ready" ? "Waiting for Craig" : st);
const daysSince = (t) => (t ? Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000)) : null);
const waited = (t) => { const d = daysSince(t); return d === null ? "" : d === 0 ? "today" : d === 1 ? "1 day" : `${d} days`; };

function JobCard({ j, staffName }) {
  const key = j.machines?.key_number;
  const serviced = j.serviced_at && (j.status === "Presale" || j.status === "Ready");
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/jobs/${j.id}`} className="text-lg font-semibold text-zinc-900 hover:text-red-700">Job #{j.job_number}</Link>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[j.status] || "bg-zinc-100 text-zinc-700"}`}>
          {statusLabel(j.status)}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-700">
        {j.customers?.name} · {j.machines?.type} {j.machines?.make} {j.machines?.model}
        {key && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-700">Key {key}</span>}
        {j.needs_presale && j.status !== "Presale" && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700">Presale</span>}
      </p>
      {j.reported_problem && <p className="mt-1 text-sm text-zinc-500">{j.reported_problem}</p>}
      {serviced && (
        <p className="mt-1 text-xs font-medium text-emerald-700">
          Serviced{staffName(j.serviced_by) ? ` by ${staffName(j.serviced_by)}` : ""}
          {j.status === "Presale" ? ` · waiting ${waited(j.serviced_at)}` : ""}
        </p>
      )}
      <div className="mt-3">
        <Link href={`/jobs/${j.id}`} className="text-sm font-medium text-red-600 hover:text-red-700">Open →</Link>
      </div>
    </div>
  );
}

function JobLine({ j }) {
  return (
    <Link href={`/jobs/${j.id}`} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 transition hover:border-zinc-300 hover:bg-white">
      <span className="w-16 shrink-0 font-medium text-zinc-800">#{j.job_number}</span>
      <span className="flex-1 truncate">{j.customers?.name} · {j.machines?.make} {j.machines?.model}</span>
      <span className="shrink-0 text-xs font-medium text-zinc-500">{j.status}</span>
    </Link>
  );
}

function SectionHeading({ children, count }) {
  return (
    <h2 className="mt-6 mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      {children}<span className="font-normal normal-case tracking-normal text-zinc-400">({count})</span>
    </h2>
  );
}

export default function JobsPage() {
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  // The job card used to start with two dropdowns: pick a customer, then pick
  // one of their machines, and if the bike wasn't on file, open a sub-panel,
  // add it, then come back. At a counter with someone waiting that is a lot of
  // tapping to write down "Honda TRX500".
  //
  // Now you type. The customer name is a plain box that matches what's already
  // on file as you go; the bike is six plain boxes, always visible. Nothing is
  // selected from a list unless you want it to be — tapping a suggestion is a
  // shortcut, never a requirement.
  const [customerId, setCustomerId] = useState(""); // set only when an existing customer is chosen
  const [custQuery, setCustQuery] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [mType, setMType] = useState("");
  const [mMake, setMMake] = useState("");
  const [mModel, setMModel] = useState("");
  const [mYear, setMYear] = useState("");
  const [mVin, setMVin] = useState("");
  const [mKey, setMKey] = useState("");
  const [problem, setProblem] = useState("");
  const [source, setSource] = useState("Phone");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [staff, setStaff] = useState([]);
  const staffName = (sid) => staff.find((x) => x.id === sid)?.name?.split(" ")[0] || "";

  async function loadData() {
    setLoading(true);
    const { data: j, error: jErr } = await supabase.from("job_cards").select("*, customers(name), machines(type, make, model, key_number)").order("created_at", { ascending: false });
    const { data: st } = await supabase.from("staff").select("id, name");
    setStaff(st || []);
    const { data: c } = await supabase.from("customers").select("id, name, phone, email").order("name");
    const { data: m } = await supabase.from("machines").select("id, customer_id, type, make, model, year, vin, key_number");
    if (jErr) setError(jErr.message);
    else setJobs(j);
    setCustomers(c || []);
    setMachines(m || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  const norm = (v) => (v || "").trim().toLowerCase();
  const machinesForCustomer = machines.filter((m) => m.customer_id === customerId);

  // Customers whose name contains what's been typed. Shown as tappable
  // suggestions under the box — not a dropdown that has to be opened, and never
  // something you're forced to choose from.
  const custMatches =
    custQuery.trim().length < 1 || customerId
      ? []
      : customers.filter((c) => norm(c.name).includes(norm(custQuery))).slice(0, 6);

  function chooseCustomer(c) {
    setCustomerId(c.id);
    setCustQuery(c.name);
    // Carry what's already on file into the boxes. A regular with a blank
    // phone can then have it filled in from here rather than being a dead end.
    setCustPhone(c.phone || "");
    setCustEmail(c.email || "");
    setError(null);
  }

  // Fill the machine boxes from a bike already on file, so a regular doesn't
  // get retyped. Still just filling the boxes — everything stays editable.
  function fillFromMachine(m) {
    setMType(m.type || "");
    setMMake(m.make || "");
    setMModel(m.model || "");
    setMYear(m.year ? String(m.year) : "");
    setMVin(m.vin || "");
    setMKey(m.key_number || "");
  }

  function resetNewJobForm() {
    setCustomerId(""); setCustQuery(""); setCustPhone(""); setCustEmail("");
    setMType(""); setMMake(""); setMModel(""); setMYear(""); setMVin(""); setMKey("");
    setProblem("");
  }

  // Everything typed into the form is resolved to real records here: the
  // customer is matched by name or created, and the machine is matched against
  // that customer's bikes or created. Matching is case-insensitive so "honda"
  // typed at the counter doesn't become a second Honda.
  async function addJob(e) {
    e.preventDefault();
    setError(null);
    if (!custQuery.trim()) { setError("Enter the customer's name."); return false; }
    if (!mMake.trim() && !mModel.trim()) { setError("Enter at least a make or a model for the bike."); return false; }
    if (mYear.trim() && !/^\d{4}$/.test(mYear.trim())) { setError("Year should be four digits, e.g. 2019."); return false; }

    // --- the customer
    //
    // Phone and email are written here, at the counter, while the person is
    // standing in front of you. The first version of this form created a
    // customer from a name alone, which meant a new walk-in had no way of being
    // phoned when the bike was ready or emailed their invoice, and no way to
    // fix that without leaving the job card. That was wrong.
    const phone = custPhone.trim();
    const mail = custEmail.trim();
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      setError("That email address doesn't look right.");
      return false;
    }

    let custId = customerId;
    if (!custId) {
      const hit = customers.find((c) => norm(c.name) === norm(custQuery));
      if (hit) custId = hit.id;
      else {
        const { data, error: cErr } = await supabase
          .from("customers")
          .insert({ name: custQuery.trim(), phone: phone || null, email: mail || null })
          .select("id, name").single();
        if (cErr) { setError("Couldn't add the customer: " + cErr.message); return false; }
        custId = data.id;
      }
    }

    // An existing customer whose details were blank, now filled in. Only ever
    // fills a gap: a number already on file is never overwritten from here,
    // because this form is not where you'd expect to change someone's details.
    if (custId) {
      const known = customers.find((c) => c.id === custId);
      const patch = {};
      if (phone && !known?.phone) patch.phone = phone;
      if (mail && !known?.email) patch.email = mail;
      if (Object.keys(patch).length) {
        await supabase.from("customers").update(patch).eq("id", custId);
      }
    }

    // --- the machine
    const year = mYear.trim() ? Number(mYear.trim()) : null;
    const mine = machines.filter((m) => m.customer_id === custId);
    const hitM = mine.find(
      (m) =>
        norm(m.make) === norm(mMake) &&
        norm(m.model) === norm(mModel) &&
        (year === null || !m.year || Number(m.year) === year)
    );
    let machId = hitM?.id;
    if (!machId) {
      const { data, error: mErr } = await supabase
        .from("machines")
        .insert({
          customer_id: custId,
          type: mType.trim() || "ATV",
          make: mMake.trim(),
          model: mModel.trim(),
          year,
          vin: mVin.trim() || null,
          key_number: mKey.trim() || null,
        })
        .select("id, customer_id, type, make, model, year, vin, key_number")
        .single();
      if (mErr) { setError("Couldn't add the machine: " + mErr.message); return false; }
      machId = data.id;
    } else if ((mVin.trim() && !hitM.vin) || (mKey.trim() && !hitM.key_number)) {
      // The bike was already on file but without a VIN or key number, and one
      // has just been typed in. Fill the gap rather than losing it — but never
      // overwrite an identifier that is already recorded.
      await supabase.from("machines").update({
        vin: hitM.vin || mVin.trim() || null,
        key_number: hitM.key_number || mKey.trim() || null,
      }).eq("id", machId);
    }

    const todayNZ = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
    const { data: existing } = await supabase.from("job_cards").select("id").eq("machine_id", machId).eq("job_date", todayNZ);
    if (existing && existing.length > 0) { setError("There's already a job card for this machine today."); return false; }

    // Don't service a bike twice. An open job on the same machine is almost
    // always the one to use; a service in the last 60 days is worth knowing
    // about before starting another. Both ask rather than refuse, because a
    // second job is sometimes right (a new fault on a bike just serviced).
    const { data: history } = await supabase.from("job_cards")
      .select("job_number, status, job_date, serviced_at")
      .eq("machine_id", machId).order("job_date", { ascending: false }).limit(10);
    const open = (history || []).find((h) => !DONE.has(h.status));
    if (open && !window.confirm(
      `This machine already has job #${open.job_number} open (${statusLabel(open.status)}).\n\nOpen that one instead of starting another? Press Cancel to go back, OK to make a new job anyway.`
    )) return false;
    const cutoff = Date.now() - 60 * 86400000;
    const recent = (history || []).find((h) => h !== open && (h.serviced_at || (DONE.has(h.status) && h.job_date)) &&
      new Date(h.serviced_at || h.job_date).getTime() >= cutoff);
    if (recent && !window.confirm(
      `Heads up: this machine was last done on job #${recent.job_number}, ${new Date(recent.serviced_at || recent.job_date).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}.\n\nMake a new job anyway?`
    )) return false;
    const { error } = await supabase.from("job_cards").insert({ customer_id: custId, machine_id: machId, reported_problem: problem, source });
    if (error) { setError(error.message); return false; }
    resetNewJobForm(); setShowNew(false); loadData();
  }

  // Separate lists, so it's clear who has each bike: not started, being
  // serviced, with Peni for Presale, waiting for Craig, finished.
  const newJobs = jobs.filter((j) => j.status === "New");
  const presaleJobs = jobs.filter((j) => j.status === "Presale")
    .sort((a, b) => new Date(a.serviced_at || a.created_at) - new Date(b.serviced_at || b.created_at));
  const craigJobs = jobs.filter((j) => j.status === "Ready");
  const doneJobs = jobs.filter((j) => DONE.has(j.status));
  const openJobs = jobs.filter((j) => !["New", "Presale", "Ready"].includes(j.status) && !DONE.has(j.status));

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

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No job cards yet. Tap “+ New job card” to start one.</p>
      ) : (
        <>
          {newJobs.length > 0 && (
            <>
              <SectionHeading count={newJobs.length}>New</SectionHeading>
              <div className="flex flex-col gap-3">
                {newJobs.map((j) => (<JobCard key={j.id} j={j} staffName={staffName} />))}
              </div>
            </>
          )}

          {openJobs.length > 0 && (
            <>
              <SectionHeading count={openJobs.length}>In the workshop</SectionHeading>
              <div className="flex flex-col gap-3">
                {openJobs.map((j) => (<JobCard key={j.id} j={j} staffName={staffName} />))}
              </div>
            </>
          )}

          {presaleJobs.length > 0 && (
            <div id="presale">
              <SectionHeading count={presaleJobs.length}>Presale (Peni)</SectionHeading>
              <div className="flex flex-col gap-3">
                {presaleJobs.map((j) => (<JobCard key={j.id} j={j} staffName={staffName} />))}
              </div>
            </div>
          )}

          {craigJobs.length > 0 && (
            <>
              <SectionHeading count={craigJobs.length}>Waiting for Craig</SectionHeading>
              <div className="flex flex-col gap-3">
                {craigJobs.map((j) => (<JobCard key={j.id} j={j} staffName={staffName} />))}
              </div>
            </>
          )}

          {doneJobs.length > 0 && (
            <>
              <button
                onClick={() => setShowDone((v) => !v)}
                className="mt-6 mb-2 flex w-full items-baseline gap-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-700"
              >
                Finished
                <span className="font-normal normal-case tracking-normal text-zinc-400">({doneJobs.length})</span>
                <span className="ml-auto font-normal normal-case tracking-normal text-zinc-400">{showDone ? "hide" : "show"}</span>
              </button>
              {showDone && (
                <div className="flex flex-col gap-1.5">
                  {doneJobs.map((j) => (<JobLine key={j.id} j={j} />))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">New job card</h2>
              <button onClick={() => setShowNew(false)} aria-label="Close" className="rounded-md p-1 text-2xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">×</button>
            </div>
            <form onSubmit={addJob} className="mt-4 flex flex-col gap-3">
              {/* Customer — typed, not picked. Matches appear underneath as
                  shortcuts; typing a name that isn't on file simply creates it. */}
              <div>
                <label className="block text-xs font-medium text-zinc-500">Customer</label>
                <div className="mt-1 flex gap-2">
                  <input
                    value={custQuery}
                    onChange={(e) => { setCustQuery(e.target.value); setCustomerId(""); }}
                    placeholder="Name — type it, new ones are added"
                    autoComplete="off"
                    className={input + " flex-1"}
                  />
                  {customerId && (
                    <button type="button" onClick={() => { setCustomerId(""); setCustQuery(""); }}
                      className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
                      clear
                    </button>
                  )}
                </div>
                {customerId ? (
                  <p className="mt-1 text-xs font-medium text-emerald-700">✓ On file — this job goes on their record</p>
                ) : custQuery.trim() ? (
                  <p className="mt-1 text-xs text-zinc-500">New customer — will be added</p>
                ) : null}
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input value={custPhone} onChange={(e) => setCustPhone(e.target.value)}
                    placeholder="Phone" inputMode="tel" autoComplete="off" className={input} />
                  <input value={custEmail} onChange={(e) => setCustEmail(e.target.value)}
                    placeholder="Email" inputMode="email" autoComplete="off" className={input} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {customerId
                    ? "Blank boxes here will be added to their record. Anything already on file is left alone."
                    : "Worth getting now — the phone number to call when it's ready, the email for the invoice."}
                </p>

                {custMatches.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {custMatches.map((c) => (
                      <button key={c.id} type="button" onClick={() => chooseCustomer(c)}
                        className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-red-300 hover:bg-red-50">
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Their bikes already on file — one tap fills the boxes below
                  rather than making anyone retype a regular's machine. */}
              {customerId && machinesForCustomer.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-500">Their bikes — tap to fill</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {machinesForCustomer.map((m) => (
                      <button key={m.id} type="button" onClick={() => fillFromMachine(m)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-red-300 hover:bg-red-50">
                        {/* Key number first: Craig's stock is mostly the same few
                            Honda models, so the key is what tells them apart. */}
                        {m.key_number && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">{m.key_number.toUpperCase()}</span>}
                        {[m.year, m.make, m.model].filter(Boolean).join(" ") || m.type}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* The bike. Six plain boxes, always open, nothing to select.
                  Key number OR VIN — either identifies it, neither is required. */}
              <div>
                <label className="block text-xs font-medium text-zinc-500">Bike</label>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <input value={mMake} onChange={(e) => setMMake(e.target.value)} placeholder="Make" autoComplete="off" className={input} />
                  <input value={mModel} onChange={(e) => setMModel(e.target.value)} placeholder="Model" autoComplete="off" className={input} />
                  <input value={mYear} onChange={(e) => setMYear(e.target.value)} placeholder="Year" inputMode="numeric" autoComplete="off" className={input} />
                  <input value={mType} onChange={(e) => setMType(e.target.value)} placeholder="Type (ATV, bike…)" autoComplete="off" className={input} />
                  <input value={mKey} onChange={(e) => setMKey(e.target.value)} placeholder="Key number" autoComplete="off" className={input} />
                  <input value={mVin} onChange={(e) => setMVin(e.target.value)} placeholder="VIN / serial" autoComplete="off" className={input} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">Make or model is enough to start. Key number or VIN — either, or neither.</p>
              </div>

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
