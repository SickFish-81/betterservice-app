"use client";

// Bookings that came in from the website. Accepting one creates the customer,
// the machine and the job card in a single database call — nothing is retyped,
// and an existing customer is matched on their email rather than duplicated.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const nz = (t) => new Date(t).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" });

export default function BookingsPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    let q = supabase.from("booking_requests").select("*").order("created_at", { ascending: false });
    if (!showAll) q = q.eq("status", "new");
    const { data, error } = await q;
    if (error) setError(error.message); else setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showAll]);

  async function accept(r) {
    setError(null); setBusyId(r.id);
    const { data, error } = await supabase.rpc("accept_booking_request", { p_id: r.id });
    setBusyId(null);
    if (error) { setError(error.message); return; }
    if (data?.id) router.push("/jobs/" + data.id);
    else load();
  }

  async function decline(r) {
    if (!window.confirm(`Decline the booking from ${r.contact_name}? Nothing is created and they aren't told automatically.`)) return;
    setError(null); setBusyId(r.id);
    const { error } = await supabase.from("booking_requests")
      .update({ status: "declined", handled_at: new Date().toISOString() }).eq("id", r.id);
    setBusyId(null);
    if (error) { setError(error.message); return; }
    load();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Booking requests</h1>
        <button onClick={() => setShowAll((v) => !v)} className="text-sm text-zinc-600 underline hover:text-zinc-900">
          {showAll ? "show new only" : "show all"}
        </button>
      </div>
      <p className="mt-1 text-zinc-600">Sent in from the website. Accepting one creates the customer, machine and job card.</p>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-zinc-500">
          {showAll ? "No booking requests yet." : "Nothing waiting — all caught up."}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-zinc-900">
                    {r.company_name ? `${r.company_name} — ${r.contact_name}` : r.contact_name}
                    {r.status !== "new" && (
                      <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">{r.status}</span>
                    )}
                    {r.pickup_needed && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">pick-up</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-zinc-600">
                    <a href={`mailto:${r.email}`} className="underline">{r.email}</a>
                    {r.phone && <> · <a href={`tel:${r.phone}`} className="underline">{r.phone}</a></>}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">{nz(r.created_at)}</p>
                </div>
                {r.status === "new" && (
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => accept(r)} disabled={busyId === r.id}
                      className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                      {busyId === r.id ? "Working…" : "Accept → job card"}
                    </button>
                    <button onClick={() => decline(r)} disabled={busyId === r.id} className="text-sm text-zinc-500 hover:underline">decline</button>
                  </div>
                )}
              </div>

              <div className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-700">
                <p><span className="font-medium text-zinc-800">Machine:</span> {[r.machine_type, r.machine_make, r.machine_model].filter(Boolean).join(" ") || "not given"}</p>
                <p className="mt-1"><span className="font-medium text-zinc-800">Needs:</span> {r.reported_problem}</p>
                {r.pickup_needed && <p className="mt-1"><span className="font-medium text-zinc-800">Pick up from:</span> {r.pickup_address || "no address given — ring them"}</p>}
                {r.notes && <p className="mt-1"><span className="font-medium text-zinc-800">Notes:</span> {r.notes}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
