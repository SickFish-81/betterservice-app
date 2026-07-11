"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [canSend, setCanSend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("staff").select("*").order("created_at");
    if (error) setError(error.message);
    else setStaff(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addStaff(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("staff").insert({ name, email: email || null, role, can_send_invoices: canSend });
    if (error) { setError(error.message); return; }
    setName(""); setEmail(""); setRole("staff"); setCanSend(false); load();
  }

  async function removeStaff(sid) {
    if (!window.confirm("Remove this staff member?")) return;
    await supabase.from("staff").delete().eq("id", sid);
    load();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Staff</h1>
      <p className="mt-1 text-zinc-600">Add Craig as <span className="font-semibold text-zinc-800">Owner</span> with <span className="font-semibold text-zinc-800">can send invoices</span> ticked. The email must match the login they'll use.</p>

      <form onSubmit={addStaff} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Login email" className={input} />
        <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input type="checkbox" checked={canSend} onChange={(e) => setCanSend(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 accent-red-600" />
          Can send invoices
        </label>
        <button type="submit" className={btn}>Add staff member</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No staff yet. Add Craig first.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                <span>
                  <span className="font-medium text-zinc-900">{s.name}</span>
                  {s.email && <span className="ml-2 text-sm text-zinc-500">{s.email}</span>}
                </span>
                <span className="flex items-center gap-2 text-sm text-zinc-500">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium capitalize text-zinc-600">{s.role}</span>
                  {s.can_send_invoices && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">can send</span>}
                  <button onClick={() => removeStaff(s.id)} className="text-xs text-red-500 hover:underline">remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
