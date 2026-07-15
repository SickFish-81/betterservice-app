"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700 disabled:opacity-50";

export default function LoginPage() {
  const router = useRouter();
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    else router.replace("/dashboard");
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <div className="flex items-center gap-2 text-lg font-bold tracking-tight text-zinc-900">
        <span className="inline-block h-5 w-5 rounded bg-red-600" /> Betterservice
      </div>
      <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900">Staff Sign In</h1>
      <p className="mt-1 text-sm text-zinc-600">The shop&apos;s back office.</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">Email</label>
          <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@betterservice.co.nz" autoComplete="email" className={input} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">Password</label>
          <input id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" autoComplete="current-password" className={input} />
        </div>
        <button disabled={busy} className={btn}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>

      {msg && <p className="mt-3 text-sm text-red-600" role="alert">{msg}</p>}

      <p className="mt-4 text-sm text-zinc-600">Need a login? Ask Craig to set one up for you.</p>
      <p className="mt-6 text-sm"><a href="/" className="text-zinc-500 hover:text-zinc-800">← Back to site</a></p>
    </main>
  );
}
