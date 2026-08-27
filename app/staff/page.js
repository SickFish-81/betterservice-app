"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const cell = "mt-1 w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm font-normal text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("staff");
  const [canSend, setCanSend] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logins, setLogins] = useState({});     // email -> true when an Auth account exists
  const [newLogin, setNewLogin] = useState(null); // {name,email,password} shown once, never stored
  const [busy, setBusy] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("staff").select("*").order("created_at");
    if (error) setError(error.message);
    else {
      setStaff(data);
      // Which of these people can actually sign in? A staff row with no matching
      // login is the failure that locked Craig out, so surface it rather than hide it.
      const { data: who } = await supabase.rpc("staff_with_logins");
      const map = {};
      (who || []).forEach((r) => { if (r.email) map[r.email.toLowerCase()] = r.has_login; });
      setLogins(map);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addStaff(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase.from("staff").insert({ name, email: email || null, phone: phone || null, role, can_send_invoices: canSend });
    if (error) { setError(error.message); return; }
    setName(""); setEmail(""); setPhone(""); setRole("staff"); setCanSend(false); load();
  }

  // Create this person's sign-in. The Edge Function checks server-side that you're
  // an owner and that the address is on the staff list before it creates anything.
  async function createLogin(s) {
    if (!s.email) { setError(`Give ${s.name} a login email first.`); return; }
    if (!window.confirm(`Create a login for ${s.name} (${s.email})?\n\nYou'll get a temporary password to pass on. They should change it once they're in.`)) return;
    setBusy(s.id); setError(null); setNewLogin(null);
    const { data: sess } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("create-staff-login", {
      body: { email: s.email, accessToken: sess?.session?.access_token },
    });
    setBusy("");
    if (error || data?.error) { setError(data?.error || error.message); return; }
    setNewLogin(data);
    load();
  }

  async function removeStaff(sid) {
    if (!window.confirm("Remove this staff member?")) return;
    await supabase.from("staff").delete().eq("id", sid);
    load();
  }

  // Save one edited field on an existing staff member. Used by every input in the
  // list, so editing is consistent and nothing needs a save button.
  async function saveField(s, field, value) {
    const next = typeof value === "string" ? value.trim() : value;
    const before = s[field] ?? (typeof value === "string" ? "" : null);
    if ((before ?? "") === (next ?? "")) return;   // nothing changed

    // Changing the email changes which login this person is. Every permission
    // check matches staff.email against the signed-in account, so a mismatch
    // silently locks them out of everything.
    if (field === "email") {
      const ok = window.confirm(
        `Change ${s.name}'s login email?\n\n` +
        `  from:  ${s.email || "(none)"}\n` +
        `  to:    ${next || "(none)"}\n\n` +
        `Their access is matched on this address. Unless a Supabase Auth account ` +
        `exists with the new address, they will be able to sign in but see nothing.`
      );
      if (!ok) { load(); return; }   // reload to snap the input back
    }

    const payload = { [field]: next === "" ? null : next };
    const { error } = await supabase.from("staff").update(payload).eq("id", s.id);
    if (error) { setError(error.message); load(); return; }
    setError(null);
    setStaff((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...payload } : x)));
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Staff</h1>
      <p className="mt-1 text-zinc-600">Team members who can log in. <span className="font-semibold text-zinc-800">Owners</span> can send invoices and manage staff — each person's email must match the login they use.</p>

      <form onSubmit={addStaff} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={input} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Login email" className={input} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Mobile number (for texts)" className={input} />
        <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
          <input type="checkbox" checked={canSend} onChange={(e) => setCanSend(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 accent-red-600" />
          Can send invoices
        </label>
        <button type="submit" className={btn}>Add staff member</button>
        <p className="text-xs text-zinc-500">Adding someone here sets their access and role — it doesn&apos;t create their login. Their sign-in (email + password) is created separately in Supabase Auth using the same email; until that exists, they can&apos;t log in.</p>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      {newLogin && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-4">
          <p className="font-semibold text-green-900">Login created for {newLogin.name}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-green-800">Email</dt><dd className="font-mono text-green-900">{newLogin.email}</dd>
            <dt className="text-green-800">Password</dt><dd className="font-mono text-green-900">{newLogin.password}</dd>
          </dl>
          <p className="mt-2 text-xs text-green-800">
            Write this down now — it is shown once and never stored. Give it to them directly, and have them change it after their first sign-in.
          </p>
          <button onClick={() => setNewLogin(null)} className="mt-2 text-xs font-medium text-green-900 underline">Done</button>
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : staff.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No staff yet. Add Craig first.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {staff.map((s) => (
              <li key={s.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_1fr] sm:gap-3">
                <div className="grid gap-2">
                  <label className="block text-xs font-medium text-zinc-500">
                    Name
                    <input defaultValue={s.name || ""} onBlur={(e) => saveField(s, "name", e.target.value)} placeholder="Name" className={cell} />
                  </label>
                  <label className="block text-xs font-medium text-zinc-500">
                    Login email
                    <input defaultValue={s.email || ""} onBlur={(e) => saveField(s, "email", e.target.value)} type="email" placeholder="name@betterservice.co.nz" className={cell} />
                  </label>
                </div>
                <div className="grid gap-2">
                  <label className="block text-xs font-medium text-zinc-500">
                    Mobile (for texts)
                    <input defaultValue={s.phone || ""} onBlur={(e) => saveField(s, "phone", e.target.value)} type="tel" placeholder="021…" className={cell} />
                  </label>
                  <label className="block text-xs font-medium text-zinc-500">
                    Role
                    <select value={s.role || "staff"} onChange={(e) => saveField(s, "role", e.target.value)} className={cell}>
                      <option value="staff">Staff</option>
                      <option value="owner">Owner</option>
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                    <input type="checkbox" checked={!!s.can_send_invoices} onChange={(e) => saveField(s, "can_send_invoices", e.target.checked)} className="h-4 w-4 rounded border-zinc-300 accent-red-600" />
                    Can send invoices
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    {s.email && logins[s.email.toLowerCase()] ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">can sign in</span>
                    ) : (
                      <button
                        onClick={() => createLogin(s)}
                        disabled={busy === s.id || !s.email}
                        title={s.email ? "Creates their sign-in account" : "Add a login email first"}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {busy === s.id ? "Creating…" : "No login — create one"}
                      </button>
                    )}
                    <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                      <input type="checkbox" checked={s.active !== false} onChange={(e) => saveField(s, "active", e.target.checked)} className="h-4 w-4 rounded border-zinc-300 accent-red-600" />
                      Active
                    </label>
                    <button onClick={() => removeStaff(s.id)} className="text-xs text-red-500 hover:underline">remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
