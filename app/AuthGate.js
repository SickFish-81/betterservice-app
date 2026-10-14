"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import NavBar from "./NavBar";
import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";
import AttentionBanner from "./AttentionBanner";
import TimesheetNudge from "./TimesheetNudge";
import { RoleContext } from "./RoleContext";

const PUBLIC_EXACT = ["/", "/login", "/reset", "/batteries", "/book", "/enquiry", "/flip-recessed-bike-mounts", "/snap-d-shackles"];
function isPublic(p) {
  return PUBLIC_EXACT.includes(p) || p === "/for-sale" || p.startsWith("/for-sale/");
}

// Money / admin areas — owners only. Workshop logins get a friendly block.
const OWNER_ONLY = ["/accounting", "/reports", "/invoices", "/credit-notes", "/bills", "/expenses", "/counter-sales", "/purchase-orders", "/suppliers", "/timesheets", "/settings", "/staff", "/secondhand", "/rentals", "/bookings", "/flip-orders"];
function isOwnerOnly(p) {
  return OWNER_ONLY.some((x) => p === x || p.startsWith(x + "/"));
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined);
  const [approved, setApproved] = useState(undefined); // undefined = checking, true/false = known
  const [owner, setOwner] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Is this signed-in user an approved (active) staff member, and an owner?
  //
  // Ask the DATABASE. It owns this rule and nothing else should hold a copy.
  //
  // This used to be a `staff` lookup matched on email, under a comment claiming
  // the database did the deciding. It didn't. The database matches
  // `user_id = auth.uid()` FIRST and falls back to email only for a staff row
  // with no login linked yet; this matched on email ALONE. Two rules for one
  // question, and they disagreed in exactly one case: a staff member whose
  // email address we had cleared.
  //
  // We clear it deliberately, when an address hard-bounces, so dispatch stops
  // firing bounces that wreck sending reputation for every Betterservice email.
  // The database was checked and tolerated it. This was not. So clearing the
  // address silently locked the person out of the whole app, and told them
  // "Awaiting approval" while every database check said they were approved.
  // That is what happened to Peni on 14 Oct 2026.
  //
  // `staff.email` is now only "where do we send this person mail". It no longer
  // decides who they are.
  useEffect(() => {
    let cancelled = false;
    if (session === undefined) return;
    if (!session) { setApproved(undefined); return; }
    setApproved(undefined);
    Promise.all([
      supabase.rpc("is_approved_staff"),
      supabase.rpc("is_owner"),
    ]).then(([a, o]) => {
      if (cancelled) return;
      // An error leaves `data` null, so a failed check reads as "not approved"
      // rather than letting someone through. Fail closed, same as before.
      setApproved(a.data === true);
      setOwner(o.data === true);
    });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (session === null && !isPublic(pathname)) router.replace("/login");
  }, [session, pathname, router]);

  const loading = <div className="p-8 text-zinc-500">Loading…</div>;

  // Public pages — no login, public header (login page shows no nav).
  if (isPublic(pathname)) {
    if (pathname === "/login" || pathname === "/reset") return children;
    return (<><PublicNav />{children}<PublicFooter /></>);
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
  if (isOwnerOnly(pathname) && !owner) {
    return (
      <RoleContext.Provider value={{ owner }}>
        <NavBar email={session.user.email} />
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-bold text-zinc-900">Owners only</h1>
            <p className="mt-2 text-sm text-zinc-600">This area is limited to the shop owners. Everything you need is on the job cards.</p>
            <a href="/jobs" className="mt-4 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Go to Job Cards</a>
          </div>
        </main>
      </RoleContext.Provider>
    );
  }

  return (
    <RoleContext.Provider value={{ owner }}>
      <NavBar email={session.user.email} />
      <TimesheetNudge />
      <AttentionBanner />
      {children}
    </RoleContext.Provider>
  );
}
