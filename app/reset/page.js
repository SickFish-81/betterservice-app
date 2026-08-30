"use client";

// Password reset — the page the emailed recovery link lands on.
// Supabase puts a one-time token in the URL; the shared client picks it up
// automatically and gives us a short-lived session, which is what lets
// updateUser() set a new password without knowing the old one.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-50";

export default function ResetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(undefined); // undefined = checking, true = link ok, false = no/expired link
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The recovery token arrives in the URL fragment. detectSessionInUrl (on by
  // default) consumes it and fires an auth event, so we watch for a session
  // rather than parsing the URL ourselves.
  useEffect(() => {
    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) { settled = true; setReady(true); }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { settled = true; setReady(true); }
      else setTimeout(() => { if (!settled) setReady(false); }, 1200);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 8) return setMsg("Use at least 8 characters.");
    if (password !== confirm) return setMsg("The two passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg(error.message);
    setDone(true);
    setTimeout(() => router.replace("/dashboard"), 1500);
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <img src="/logo.png" alt="Betterservice ATV" className="h-12 w-auto" />
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900">Set a new password</h1>

      {ready === undefined && <p className="mt-4 text-sm text-zinc-500">Checking your link…</p>}

      {ready === false && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-zinc-600">
            This reset link is expired or has already been used. Reset links last one hour and only work once.
          </p>
          <a href="/login" className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Request a new one</a>
        </div>
      )}

      {ready === true && !done && (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">New password</label>
            <input id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="At least 8 characters" autoComplete="new-password" className={input} />
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-zinc-700">Confirm password</label>
            <input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} type="password" placeholder="Type it again" autoComplete="new-password" className={input} />
          </div>
          <button disabled={busy} className={btn}>{busy ? "Saving…" : "Save password"}</button>
        </form>
      )}

      {done && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="text-sm font-medium text-green-800">Password saved — signing you in…</p>
        </div>
      )}

      {msg && <p className="mt-3 text-sm text-red-600" role="alert">{msg}</p>}
    </main>
  );
}
