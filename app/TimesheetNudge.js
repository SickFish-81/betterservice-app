"use client";

// Betterservice — Timesheet nudge. Working on jobs IS the shop's clock in/out, so
// this gently reminds a signed-in staff member to log their hours on a job card
// when they've gone ~3 hours without logging any time AND aren't currently clocked
// on to a running timer. "Later" snoozes it for 3 hours, so it re-prompts roughly
// every 3 hours until time is logged.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

const GAP_MS = 3 * 60 * 60 * 1000; // 3 hours
const SNOOZE_KEY = "bs_timesheet_snooze_until";

export default function TimesheetNudge() {
  const [show, setShow] = useState(false);

  async function check() {
    // Snoozed?
    try {
      const until = Number(window.localStorage.getItem(SNOOZE_KEY) || 0);
      if (until && Date.now() < until) { setShow(false); return; }
    } catch (_e) { /* ignore */ }

    const { data: auth } = await supabase.auth.getUser();
    const email = auth?.user?.email;
    if (!email) { setShow(false); return; }

    const { data: staff } = await supabase.from("staff").select("id").ilike("email", email).limit(1);
    const sid = staff && staff[0] && staff[0].id;
    if (!sid) { setShow(false); return; }

    // Currently clocked on (a running timer)? Then they're already tracking — no nudge.
    const { data: running } = await supabase
      .from("job_time_entries").select("id")
      .eq("staff_id", sid).is("ended_at", null).not("started_at", "is", null).limit(1);
    if (running && running.length) { setShow(false); return; }

    // Most recent time entry for this staff member.
    const { data: latest } = await supabase
      .from("job_time_entries").select("started_at, ended_at, created_at")
      .eq("staff_id", sid).order("created_at", { ascending: false }).limit(1);
    const e = latest && latest[0];
    const lastMs = e ? new Date(e.ended_at || e.started_at || e.created_at).getTime() : 0;
    setShow(!e || (Date.now() - lastMs) >= GAP_MS);
  }

  useEffect(() => {
    check();
    const t = setInterval(check, 5 * 60 * 1000); // re-check every 5 minutes
    return () => clearInterval(t);
  }, []);

  function snooze() {
    try { window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + GAP_MS)); } catch (_e) { /* ignore */ }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2 text-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-700"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span className="text-amber-900">Time check — log your hours on the job you&apos;re working so your timesheet stays accurate.</span>
        <Link href="/jobs" className="ml-auto shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700">Log time</Link>
        <button onClick={snooze} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">Later</button>
      </div>
    </div>
  );
}
