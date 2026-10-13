"use client";

// My notifications — what the app has told me.
//
// This exists because a pick-up dispatch used to have only two ways to reach
// someone: a web push, which needs them to have pressed "Turn on
// notifications" on their own phone, and an email. Craig, Bjorn and Peni had
// done neither, and bjorn@ and peni@ were never created in Fastmail at all —
// so mail to them is rejected outright. Job #70 bounced on 11 Oct and nothing
// anywhere recorded that Bjorn had been dispatched.
//
// send-dispatch now writes the notification BEFORE it tries push or email, so
// this page works for someone with no phone set up and no email address. That
// is the whole point: it is the channel that cannot fail quietly.
//
// Every staff member sees only their own — the database enforces that with
// current_staff_id(), which falls back from auth.uid() to email, because the
// people this is for are exactly the ones with no email.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const when = (iso) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return d.toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const mapsUrl = (address) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

export default function NotificationsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from("staff_notifications")
      .select("id, kind, title, body, url, address, job_id, created_at, read_at")
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (e) setError(e.message);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Marked read on arrival, not on tap. Opening the page IS reading them, and
  // a badge that needs clearing one by one just becomes another chore.
  useEffect(() => {
    const unread = rows.filter((r) => !r.read_at).map((r) => r.id);
    if (unread.length === 0) return;
    const stamp = new Date().toISOString();
    (async () => {
      await supabase.from("staff_notifications").update({ read_at: stamp }).in("id", unread);
      setRows((rs) => rs.map((r) => (r.read_at ? r : { ...r, read_at: stamp })));
    })();
    // Deliberately keyed on the ids, so a later load doesn't re-run for rows
    // already stamped.
  }, [rows.map((r) => (r.read_at ? "" : r.id)).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clearing hides it from this list for good — there is no undo offered and
  // none is wanted. The ROW survives, because "was Bjorn actually told about
  // job #70" is the question this whole table exists to answer, and the person
  // most likely to clear a dispatch is the one who would rather it had not
  // been recorded. The database has no delete grant at all, so this cannot
  // destroy anything even if it tried.
  async function clearOne(id) {
    setClearing(id);
    setError(null);
    const { error: e } = await supabase
      .from("staff_notifications")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("id", id);
    setClearing(null);
    if (e) { setError(e.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  async function clearAll() {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    setClearing("all");
    setError(null);
    const { error: e } = await supabase
      .from("staff_notifications")
      .update({ dismissed_at: new Date().toISOString() })
      .in("id", ids);
    setClearing(null);
    if (e) { setError(e.message); return; }
    setRows([]);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">My Notifications</h1>
      <p className="text-xs text-zinc-500">Jobs you&rsquo;ve been sent. These stay here whether or not your phone buzzed.</p>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {!loading && rows.length > 1 && (
        <button
          onClick={clearAll}
          disabled={clearing === "all"}
          className="mt-3 text-sm font-medium text-zinc-500 underline hover:text-zinc-800 disabled:opacity-50"
        >
          {clearing === "all" ? "Clearing…" : `Clear all ${rows.length}`}
        </button>
      )}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading&hellip;</p>
      ) : rows.length === 0 ? (
        <p className="mt-5 rounded-xl border border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500 shadow-sm">
          Nothing yet. Pick-ups sent to you will show up here.
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {rows.map((n) => (
            <li
              key={n.id}
              className={
                "rounded-xl border bg-white p-3 shadow-sm " +
                (n.read_at ? "border-zinc-200" : "border-zinc-200 border-l-[3px] border-l-red-600")
              }
            >
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-zinc-900">{n.title}</span>
                {!n.read_at && (
                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">NEW</span>
                )}
                <span className="ml-auto whitespace-nowrap text-xs text-zinc-500">{when(n.created_at)}</span>
              </div>

              {n.body && (
                <p className="mt-1.5 whitespace-pre-line text-sm text-zinc-700">{n.body}</p>
              )}

              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {n.url && (
                  <Link href={n.url} className="font-medium text-red-600 hover:underline">
                    Open the job card
                  </Link>
                )}
                {n.address ? (
                  <a
                    href={mapsUrl(n.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-red-600 hover:underline"
                  >
                    Directions
                  </a>
                ) : (
                  // Said rather than silently omitted: a missing button looks
                  // exactly like one that failed to render, and the driver is
                  // the one who finds out, in a yard, later.
                  <span className="text-xs italic text-zinc-500">No pick-up address was given.</span>
                )}

                <button
                  onClick={() => clearOne(n.id)}
                  disabled={clearing === n.id}
                  className="ml-auto font-medium text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                >
                  {clearing === n.id ? "Clearing…" : "Clear"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
