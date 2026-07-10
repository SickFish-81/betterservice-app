"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-50";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace("/dashboard"); });
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else router.replace("/dashboard");
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setMsg(error.message);
      else if (data.session) router.replace("/dashboard");
      else setMsg("Account created — check your email to confirm, then sign in. (Or turn off 'Confirm email' in Supabase to skip this.)");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <div className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
        <span className="inline-block h-5 w-5 rounded bg-red-600" /> Betterservice
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900">{mode === "signin" ? "Staff sign in" : "Create your login"}</h1>
      <p className="mt-1 text-sm text-zinc-600">{mode === "signin" ? "The shop's back office." : "Set up a staff login."}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email" autoComplete="email" className={input} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete={mode === "signin" ? "current-password" : "new-password"} className={input} />
        <button disabled={busy} className={btn}>{busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}</button>
      </form>

      {msg && <p className="mt-3 text-sm text-zinc-700">{msg}</p>}

      <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }} className="mt-4 text-sm font-medium text-red-600 hover:text-red-700">
        {mode === "signin" ? "Need a login? Create account" : "Have a login? Sign in"}
      </button>
      <p className="mt-6 text-sm"><a href="/" className="text-zinc-400 hover:text-zinc-700">← Back to site</a></p>
    </main>
  );
}
