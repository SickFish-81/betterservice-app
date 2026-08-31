"use client";

// Shared public form, used two ways:
//   mode="booking" — /book, "I have a machine, please do the work"
//   mode="enquiry" — /enquiry, "I have a question"
// An enquiry doesn't demand machine details or a pick-up, because the person
// asking may not have brought a machine into it yet. Both land in the same
// holding pen, tagged so staff can tell them apart.
//
// The only thing this can do is call submit_booking_request() — it reads no
// table. See migrations 0047 and 0049.

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const label = "mb-1 block text-sm font-medium text-zinc-700";

export default function BookingForm({ mode = "booking" }) {
  const enquiry = mode === "enquiry";
  const [f, setF] = useState({
    contact: "", email: "", phone: "", company: "",
    type: "", make: "", model: "", problem: "",
    pickup: false, pickupAddress: "", notes: "", trap: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.rpc("submit_booking_request", {
      p_contact: f.contact, p_email: f.email, p_problem: f.problem,
      p_company: f.company || null, p_phone: f.phone || null,
      p_machine_type: f.type || null, p_machine_make: f.make || null, p_machine_model: f.model || null,
      p_pickup: !!f.pickup, p_pickup_address: f.pickupAddress || null,
      p_notes: f.notes || null, p_trap: f.trap || null, p_kind: mode,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6">
          <h1 className="text-xl font-bold text-green-900">{enquiry ? "Thanks — message sent." : "Thanks — that\u2019s booked in."}</h1>
          <p className="mt-2 text-sm text-green-800">
            {enquiry
              ? "Craig will get back to you. If it\u2019s urgent, call or text 021 08327787."
              : "Craig will be in touch to confirm a time. If it\u2019s urgent, call or text 021 08327787."}
          </p>
          <a href="/" className="mt-5 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Back to the site</a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{enquiry ? "Make an enquiry" : "Book a service"}</h1>
      <p className="mt-1 text-zinc-600">
        {enquiry
          ? "Ask us anything \u2014 whether we work on your machine, roughly what something costs, parts we can get. No obligation."
          : "Tell us what you need and we\u2019ll come back to you to confirm a time. No need to call."}
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <fieldset className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-zinc-900">Your details</legend>
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <label htmlFor="contact" className={label}>Your name</label>
              <input id="contact" value={f.contact} onChange={set("contact")} required className={input} />
            </div>
            <div>
              <label htmlFor="email" className={label}>Email</label>
              <input id="email" value={f.email} onChange={set("email")} type="email" required className={input} />
              <p className="mt-1 text-xs text-zinc-500">We&apos;ll reply here, and send your invoice to this address.</p>
            </div>
            <div>
              <label htmlFor="phone" className={label}>Phone</label>
              <input id="phone" value={f.phone} onChange={set("phone")} type="tel" className={input} />
            </div>
            <div>
              <label htmlFor="company" className={label}>Business name <span className="font-normal text-zinc-500">(leave blank if it&apos;s not for a business)</span></label>
              <input id="company" value={f.company} onChange={set("company")} className={input} />
              <p className="mt-1 text-xs text-zinc-500">If the invoice needs to go to a business, put its name here.</p>
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-zinc-900">The machine {enquiry && <span className="font-normal text-zinc-500">(if it\u2019s about one)</span>}</legend>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label htmlFor="type" className={label}>Type</label><input id="type" value={f.type} onChange={set("type")} placeholder="ATV / bike" className={input} /></div>
            <div><label htmlFor="make" className={label}>Make</label><input id="make" value={f.make} onChange={set("make")} placeholder="Honda" className={input} /></div>
            <div><label htmlFor="model" className={label}>Model</label><input id="model" value={f.model} onChange={set("model")} placeholder="TRX500" className={input} /></div>
          </div>
          <div className="mt-3">
            <label htmlFor="problem" className={label}>{enquiry ? "What would you like to know?" : "What needs doing?"}</label>
            <textarea id="problem" value={f.problem} onChange={set("problem")} rows={3} required={!enquiry} placeholder={enquiry ? "Your question" : "A service, or what's gone wrong"} className={input} />
          </div>
        </fieldset>

        {!enquiry && (
        <fieldset className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-zinc-900">Getting it to us</legend>
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={f.pickup} onChange={(e) => setF((v) => ({ ...v, pickup: e.target.checked }))} />
            I need it picked up
          </label>
          {f.pickup && (
            <div className="mt-3">
              <label htmlFor="paddr" className={label}>Pick-up address</label>
              <input id="paddr" value={f.pickupAddress} onChange={set("pickupAddress")} className={input} />
            </div>
          )}
          <div className="mt-3">
            <label htmlFor="notes" className={label}>Anything else</label>
            <textarea id="notes" value={f.notes} onChange={set("notes")} rows={2} placeholder="Best days, gate codes, dogs — whatever helps" className={input} />
          </div>
        </fieldset>
        )}
        {enquiry && (
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
            <label htmlFor="notes" className={label}>Anything else</label>
            <textarea id="notes" value={f.notes} onChange={set("notes")} rows={2} className={input} />
          </div>
        )}

        {/* Honeypot: hidden from people, irresistible to bots. Never filled by a human. */}
        <input value={f.trap} onChange={set("trap")} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <button disabled={busy} className="rounded-lg bg-red-600 px-4 py-3 font-medium text-white transition hover:bg-red-700 disabled:opacity-50">
          {busy ? "Sending…" : enquiry ? "Send enquiry" : "Send booking request"}
        </button>
        <p className="text-center text-sm text-zinc-500">Or call Craig on 021 08327787.</p>
      </form>
    </main>
  );
}
