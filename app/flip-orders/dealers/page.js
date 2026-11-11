"use client";

// FLIP dealers — the trade customers Craig has saved.
//
// A saved dealer does two jobs:
//   * on a trade order Craig enters, picking them fills in who pays and
//     prices the order from their tier;
//   * with "Can order online" ticked, they can sign in at
//     flipbikes.co.nz/trade with this email and place dropship orders
//     themselves, on account.
//
// Signing in there is by a code emailed to THIS address, so the email is the
// key to the account: change it and the old address can no longer get in.
// "Sign out everywhere" ends every session they have open, for a lost phone
// or someone who has left the business. Unticking "Can order online" does the
// same and keeps them out.
//
// There is no delete. Orders point at the dealer they were for, so a dealer
// who stops trading is switched off, not erased.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900";
const BLANK = { id: null, business: "", contact: "", email: "", phone: "", address: "", tier_id: "standard", portal_access: false, notes: "" };

export default function FlipDealersPage() {
  const [dealers, setDealers] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [staffId, setStaffId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [d, t] = await Promise.all([
      supabase.from("flip_dealers").select("id, business, contact, email, phone, address, tier_id, portal_access, session_version, notes").order("business"),
      supabase.from("flip_price_tiers").select("id, name, sort").order("sort"),
    ]);
    if (d.error || t.error) setError((d.error || t.error).message);
    setDealers(d.data || []);
    setTiers(t.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("current_staff_id");
      if (data) setStaffId(data);
    })();
  }, []);

  const tierName = (id) => tiers.find((t) => t.id === id)?.name || id;

  async function save() {
    setError(null); setNotice(null);
    const e = editing;
    const email = e.email.trim().toLowerCase();
    if (!e.business.trim()) return setError("Enter the business name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter the email their invoices go to (it's also how they sign in).");
    const row = {
      business: e.business.trim(), contact: e.contact.trim() || null, email,
      phone: e.phone.trim() || null, address: e.address.trim() || null,
      tier_id: e.tier_id, portal_access: e.portal_access, notes: e.notes.trim() || null,
    };
    setBusy(true);
    const r = e.id
      ? await supabase.from("flip_dealers").update({ ...row, updated_at: new Date().toISOString() }).eq("id", e.id)
      : await supabase.from("flip_dealers").insert({ ...row, created_by: staffId });
    setBusy(false);
    if (r.error) {
      return setError(/flip_dealers_email_unique/.test(r.error.message)
        ? "Another dealer already has that email address." : r.error.message);
    }
    setNotice(`${row.business} saved.${row.portal_access && !e.id ? " Send them the link: flipbikes.co.nz/trade" : ""}`);
    setEditing(null);
    await load();
  }

  async function signOutEverywhere(d) {
    if (!window.confirm(`Sign ${d.business} out of the dealer portal on every device? They can sign back in with a new code.`)) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.from("flip_dealers")
      .update({ session_version: d.session_version + 1, updated_at: new Date().toISOString() }).eq("id", d.id);
    setBusy(false);
    if (e) setError(e.message); else setNotice(`${d.business} has been signed out everywhere.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <Link href="/flip-orders" className="text-sm text-zinc-600 underline">← FLIP orders</Link>
      <div className="mt-3 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">Dealers</h1>
        <Link href="/flip-orders/trade-prices" className="text-sm font-medium text-red-700 underline">Price tiers</Link>
        {!editing && (
          <button onClick={() => { setEditing({ ...BLANK }); setNotice(null); }}
            className="ml-auto rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">
            Add dealer
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Trade customers. Dealers with <b>Can order online</b> sign in at <b>flipbikes.co.nz/trade</b> with
        the email below and place orders on account.
      </p>

      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {notice && <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {editing && (
        <section className="mt-5 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
            {editing.id ? `Edit ${editing.business}` : "New dealer"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["business", "Business *"], ["contact", "Contact name"],
              ["email", "Email for invoices and sign-in *"], ["phone", "Phone"],
            ].map(([k, label]) => (
              <label key={k} className="block">
                <span className="text-xs font-medium text-zinc-600">{label}</span>
                <input className={`${input} mt-1`} value={editing[k] || ""} type={k === "email" ? "email" : "text"}
                  onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
              </label>
            ))}
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-zinc-600">Billing address (printed on invoices)</span>
              <input className={`${input} mt-1`} value={editing.address || ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-600">Price tier</span>
              <select className={`${input} mt-1`} value={editing.tier_id} onChange={(e) => setEditing({ ...editing, tier_id: e.target.value })}>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-800">
              <input type="checkbox" checked={editing.portal_access} onChange={(e) => setEditing({ ...editing, portal_access: e.target.checked })} />
              Can order online
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-zinc-600">Notes (only you see these)</span>
              <input className={`${input} mt-1`} value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={save} disabled={busy} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? "Saving…" : "Save dealer"}
            </button>
            <button onClick={() => setEditing(null)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50">Cancel</button>
          </div>
        </section>
      )}

      {loading ? <p className="mt-6 text-zinc-500">Loading…</p> : dealers.length === 0 ? (
        <p className="mt-6 rounded-xl border border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500 shadow-sm">No dealers saved yet.</p>
      ) : (
        <ul className="mt-5 space-y-2">
          {dealers.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900">
                  {d.business}
                  {d.portal_access
                    ? <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-green-800">Orders online</span>
                    : <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-500">No portal</span>}
                </p>
                <p className="text-xs text-zinc-500">
                  {[d.contact, d.email, d.phone].filter(Boolean).join(" · ")} · {tierName(d.tier_id)} prices
                </p>
                {d.notes && <p className="text-xs text-zinc-400">{d.notes}</p>}
              </div>
              {d.portal_access && (
                <button onClick={() => signOutEverywhere(d)} disabled={busy}
                  className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50">
                  Sign out everywhere
                </button>
              )}
              <button onClick={() => { setEditing({ ...BLANK, ...d, contact: d.contact || "", phone: d.phone || "", address: d.address || "", notes: d.notes || "" }); setNotice(null); window.scrollTo(0, 0); }}
                className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
