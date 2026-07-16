"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import NavBar from "./NavBar";
import PublicNav from "./PublicNav";
import AttentionBanner from "./AttentionBanner";

const PUBLIC_EXACT = ["/", "/login", "/batteries"];
function isPublic(p) {
  return PUBLIC_EXACT.includes(p) || p === "/for-sale" || p.startsWith("/for-sale/");
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [approved, setApproved] = useState(undefined); // undefined = checking, true/false = known
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Is this signed-in user an approved (active) staff member? The database only
  // returns a staff row to approved staff, so a returned row === approved.
  useEffect(() => {
    let cancelled = false;
    if (session === undefined) return;
    if (!session) { setApproved(undefined); return; }
    setApproved(undefined);
    supabase.from("staff").select("active").ilike("email", session.user.email).limit(1)
      .then(({ data }) => { if (!cancelled) setApproved(!!(data && data.length && data[0].active !== false)); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (session === null && !isPublic(pathname)) router.replace("/login");
  }, [session, pathname, router]);

  const loading = <div className="p-8 text-zinc-500">Loading…</div>;

  // Public pages — no login, public header (login page shows no nav).
  if (isPublic(pathname)) {
    if (pathname === "/login") return children;
    return (<><PublicNav />{children}</>);
  }

  // Staff pages — require login AND owner approval.
  if (session === undefined) return loading;
  if (!session) return null;
  if (approved === undefined) return loading;
  if (!approved) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <span className="inline-block h-6 w-6 rounded bg-red-600" />
          <h1 className="mt-4 text-xl font-bold text-zinc-900">Awaiting approval</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Your login <span className="font-medium text-zinc-800">{session.user.email}</span> isn&apos;t approved yet.
            An owner (Craig or Ben) needs to add you to the staff list before you can use the shop tools.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button onClick={() => supabase.auth.signOut()} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">Sign out</button>
            <a href="/" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Back to site</a>
          </div>
        </div>
      </main>
    );
  }
  return (<><NavBar email={session.user.email} /><AttentionBanner />{children}</>);
}
