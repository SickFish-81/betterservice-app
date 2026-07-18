"use client";

// Betterservice — Timesheets (owner-only): hours worked per person over a period,
// rolled up from the time clocked on job cards (job_time_entries) via the
// owner-gated timesheet() RPC.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const hh = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

function ymd(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0"); return `${y}-${m}-${day}`; }
function weekStart(d) { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x; }
function presets() {
  const today = new Date();
  const ws = weekStart(today);
  const wEnd = new Date(ws); wEnd.setDate(wEnd.getDate() + 6);
  const lwStart = new Date(ws); lwStart.setDate(lwStart.getDate() - 7);
  const lwEnd = new Date(ws); lwEnd.setDate(lwEnd.getDate() - 1);
  const mStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const mEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    "This week": [ymd(ws), ymd(wEnd)],
    "Last week": [ymd(lwStart), ymd(lwEnd)],
    "This month": [ymd(mStart), ymd(mEnd)],
  };
}

export default function TimesheetsPage() {
  const P = useMemo(presets, []);
  const [label, setLabel] = useState("This week");
  const [from, setFrom] = useState(P["This week"][0]);
  const [to, setTo] = useState(P["This week"][1]);
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    const { data, error } = await supabase.rpc("timesheet", { p_from: from, p_to: to });
    if (error) setError(error.message); else setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [from, to]);

  function pick(l) { setLabel(l); if (P[l]) { setFrom(P[l][0]); setTo(P[l][1]); } }

  const staff = useMemo(() => {
    const by = {};
    (rows || []).forEach((r) => {
      const k = r.staff_id || "unknown";
      if (!by[k]) by[k] = { id: k, name: r.staff_name || "Unknown", total: 0, billed: 0, running: 0, jobs: new Set(), entries: [] };
      by[k].total += Number(r.hours) || 0;
      if (r.billed) by[k].billed += Number(r.hours) || 0;
      if (r.running) by[k].running += 1;
      if (r.job_card_id) by[k].jobs.add(r.job_card_id);
      by[k].entries.push(r);
    });
    return Object.values(by).sort((a, b) => b.total - a.total);
  }, [rows]);

  const teamTotal = staff.reduce((s, x) => s + x.total, 0);
  const teamBilled = staff.reduce((s, x) => s + x.billed, 0);

  function exportCsv() {
    const head = ["Staff", "Date", "Job", "Hours", "Billed", "Note"];
    const body = (rows || []).map((r) => [r.staff_name, r.work_date, r.job_number ? "#" + r.job_number : "", r.running ? "running" : hh(r.hours), r.billed ? "yes" : "no", r.note || ""]);
    const all = [["Timesheet " + from + " to " + to], head, ...body, [], ["Team total (h)", hh(teamTotal)]];
    const csv = all.map((row) => row.map((c) => { const s = String(c ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `timesheet-${from}_to_${to}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const pill = (active) => "rounded-lg px-3 py-1.5 text-sm font-medium " + (active ? "bg-red-600 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Timesheets</h1>
      <p className="mt-1 text-zinc-600">Hours worked per person, from the time clocked on job cards. Pick a period to total it up.</p>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {Object.keys(P).map((l) => <button key={l} onClick={() => pick(l)} className={pill(label === l)}>{l}</button>)}
        <button onClick={() => setLabel("Custom")} className={pill(label === "Custom")}>Custom</button>
      </div>
      {label === "Custom" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-600">
          <label className="flex items-center gap-1">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5" /></label>
          <label className="flex items-center gap-1">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1.5" /></label>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-sm text-zinc-500">{from} → {to}</p>
          <p className="text-2xl font-bold text-zinc-900">{hh(teamTotal)} <span className="text-base font-medium text-zinc-500">hours</span></p>
          <p className="text-xs text-zinc-500">{hh(teamBilled)} h billed as labour</p>
        </div>
        <button onClick={exportCsv} disabled={!rows.length} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">Export CSV</button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-4">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No hours logged in this period. Time clocked on job cards shows up here.</p>
        ) : (
          <ul className="space-y-2">
            {staff.map((s) => (
              <li key={s.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                <button onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-zinc-50">
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-900">{s.name}{s.running > 0 && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{s.running} running</span>}</p>
                    <p className="text-xs text-zinc-500">{s.entries.length} {s.entries.length === 1 ? "entry" : "entries"} · {s.jobs.size} {s.jobs.size === 1 ? "job" : "jobs"} · {hh(s.billed)} h billed</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xl font-bold text-zinc-900">{hh(s.total)}<span className="text-sm font-medium text-zinc-500"> h</span></span>
                    <span className="text-zinc-400">{open[s.id] ? "▴" : "▾"}</span>
                  </div>
                </button>
                {open[s.id] && (
                  <ul className="divide-y divide-zinc-100 border-t border-zinc-100 text-sm">
                    {s.entries.map((r, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                        <span className="min-w-0 truncate text-zinc-700">
                          {r.work_date}
                          {r.job_number && <Link href={`/jobs/${r.job_card_id}`} className="ml-2 text-red-600 hover:underline">Job #{r.job_number}</Link>}
                          {r.note && <span className="ml-2 text-zinc-500">· {r.note}</span>}
                          {r.running && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">running</span>}
                        </span>
                        <span className="shrink-0 text-zinc-800">{r.running ? "—" : hh(r.hours) + " h"}{r.billed && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">billed</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
