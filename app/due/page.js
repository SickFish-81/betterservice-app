"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const MIN_MONTHS = 12; // annual service is due at 12 months
const MAX_MONTHS = 18; // past this they've usually moved on
const LIMIT = 5;       // keep it a manageable chase list

function monthsSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
}

const telDigits = (p) => (p || "").replace(/[^\d+]/g, "");

export default function DuePage() {
  const [rows, setRows] = useState([]);
  const [totalInWindow, setTotalInWindow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sendingId, setSendingId] = useState(null);

  async function load() {
    setLoading(true);
    // last_service_date is set when an invoice is sent — that's the reminder clock's start point.
    const { data: machines, error: mErr } = await supabase
      .from("machines")
      .select("id, customer_id, type, make, model, rego, last_service_date, last_reminder_sent, customers(name, phone, email, no_reminders)");
    if (mErr) { setError(mErr.message); setLoading(false); return; }

    const inWindow = (machines || [])
      .map((m) => {
        const last = m.last_service_date || null;
        const reminded = m.last_reminder_sent && last && new Date(m.last_reminder_sent) >= new Date(last);
        return { ...m, last, months: monthsSince(last), reminded };
      })
      .filter((m) => m.months !== null && m.months >= MIN_MONTHS && m.months <= MAX_MONTHS && !m.customers?.no_reminders)
      .sort((a, b) => {
        const ar = a.reminded ? 1 : 0, br = b.reminded ? 1 : 0;
        if (ar !== br) return ar - br;      // not-yet-reminded first
        return b.months - a.months;          // then most overdue
      });

    setTotalInWindow(inWindow.length);
    setRows(inWindow.slice(0, LIMIT));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function markReminded(machineId) {
    await supabase.from("machines").update({ last_reminder_sent: new Date().toISOString() }).eq("id", machineId);
    load();
  }

  async function sendReminder(m) {
    const email = m.customers?.email;
    if (!email) { setError("No email on file for this customer — call or text them, then hit “Mark done”."); return; }
    setError(null); setSendingId(m.id);
    const machineLabel = [m.type, m.make, m.model].filter(Boolean).join(" ");
    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("send-reminder", {
      body: { to: email, customerName: m.customers?.name, machineLabel, accessToken: session?.access_token || null },
    });
    if (fErr || res?.error) {
      let detail = res?.error || (fErr && fErr.message) || "Unknown error";
      try { if (fErr && fErr.context && fErr.context.json) { const b = await fErr.context.json(); if (b && b.error) detail = b.error; } } catch (_e) {}
      setError("Couldn't send the reminder: " + detail); setSendingId(null); return;
    }
    await supabase.from("machines").update({ last_reminder_sent: new Date().toISOString() }).eq("id", m.id);
    setSendingId(null); load();
  }

  async function dontRemind(m) {
    if (!m.customer_id) return;
    if (!window.confirm(`Stop service reminders for ${m.customers?.name || "this customer"}? They'll drop off this list. You can switch it back on from their customer record.`)) return;
    await supabase.from("customers").update({ no_reminders: true }).eq("id", m.customer_id);
    load();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Due for service</h1>
      <p className="mt-1 text-zinc-600">Service falls due 12 months after the last invoice. Your chase list: the {LIMIT} most overdue, {MIN_MONTHS}&ndash;{MAX_MONTHS} months on.</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No one in the {MIN_MONTHS}&ndash;{MAX_MONTHS} month window right now. Machines appear here 12 months after their last invoiced service.</p>
      ) : (
        <>
          <p className="mt-4 text-sm font-medium text-zinc-700">
            Showing {rows.length}{totalInWindow > LIMIT ? ` of ${totalInWindow} due` : ""}
          </p>
          <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {rows.map((m) => {
              const digits = telDigits(m.customers?.phone);
              return (
                <li key={m.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-900">{m.type} {m.make} {m.model} <span className="text-sm font-normal text-red-700">&middot; {m.months} mo</span></p>
                      <p className="truncate text-sm text-zinc-500">{m.customers?.name} &middot; {m.customers?.phone}{m.customers?.email ? " · " + m.customers.email : ""}</p>
                    </div>
                    {m.reminded && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Reminded {new Date(m.last_reminder_sent).toLocaleDateString("en-NZ")}</span>
                    )}
                  </div>
                  {!m.reminded && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      {m.customers?.email ? (
                        <button onClick={() => sendReminder(m)} disabled={sendingId === m.id} className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                          {sendingId === m.id ? "Sending…" : "Email reminder"}
                        </button>
                      ) : digits ? (
                        <>
                          <a href={`tel:${digits}`} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">Call</a>
                          <a href={`sms:${digits}`} className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-700">Text</a>
                        </>
                      ) : (
                        <span className="text-xs text-zinc-500">no contact details</span>
                      )}
                      <button onClick={() => markReminded(m.id)} className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50">Mark done</button>
                      <button onClick={() => dontRemind(m)} className="ml-auto text-xs font-medium text-zinc-500 hover:text-red-600">Don&apos;t remind</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
