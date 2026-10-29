"use client";

// FLIP orders — what the online shop has sold and what still has to go out.
//
// The shop writes every paid order into flip_orders and emails Craig. That
// email was the only nudge there was, and an email is a thing you read once:
// nothing anywhere said how many orders were still sitting on the bench.
//
// This page is that list. One question — what is still to pack — and one
// button that answers it.
//
// The button is deliberately the only thing on here that writes. The database
// grants an owner UPDATE on packed_at and packed_by and nothing else, so even
// if this page were wrong it could not rewrite a customer's address or what
// they paid.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);

const when = (iso) =>
  new Date(iso).toLocaleString("en-NZ", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

const invoiceNo = (n) => (n ? "FLIP-" + n : "—");

export default function FlipOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [staffId, setStaffId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [showSent, setShowSent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from("flip_orders")
      .select("session_id, created_at, invoice_number, name, email, phone, country, address, items, amount_total, shipping_amount, packed_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (e) setError(e.message);
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Who is signing orders off. Looked up rather than passed in, because
  // AuthGate shares the role but not the staff row's id.
  //
  // Via current_staff_id() rather than a lookup on email: the database matches
  // user_id first, and matching on email alone meant that clearing someone's
  // address (which we do when it hard-bounces) left packed_by null and the
  // sign-off unattributable. See the note in AuthGate.js.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("current_staff_id");
      if (data) setStaffId(data);
    })();
  }, []);

  async function markPacked(order) {
    setBusy(order.session_id);
    setError(null);
    const { error: e } = await supabase
      .from("flip_orders")
      .update({ packed_at: new Date().toISOString(), packed_by: staffId })
      .eq("session_id", order.session_id);
    setBusy(null);
    // Reload rather than patching state locally: if the write was refused the
    // list must show what the database actually holds, not what we hoped.
    if (e) setError(e.message);
    await load();
  }

  const toPack = orders.filter((o) => !o.packed_at);
  const sent = orders.filter((o) => o.packed_at);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">FLIP Orders</h1>
        <p className="text-xs text-zinc-500">from flipbikes.co.nz</p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : (
        <>
          <section className="mt-5">
            <p className="mb-1.5 ml-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
              To pack {toPack.length > 0 && `(${toPack.length})`}
            </p>

            {toPack.length === 0 ? (
              <p className="rounded-xl border border-zinc-200 bg-white px-3 py-4 text-sm text-zinc-500 shadow-sm">
                Nothing waiting. Every paid order has been sent.
              </p>
            ) : (
              <ul className="space-y-2">
                {toPack.map((o) => (
                  <OrderCard
                    key={o.session_id}
                    order={o}
                    busy={busy === o.session_id}
                    onPack={() => markPacked(o)}
                  />
                ))}
              </ul>
            )}
          </section>

          {sent.length > 0 && (
            <section className="mt-6">
              <button
                onClick={() => setShowSent((v) => !v)}
                className="text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400 hover:text-zinc-600"
              >
                {showSent ? "Hide" : "Show"} sent ({sent.length})
              </button>
              {showSent && (
                <ul className="mt-2 space-y-1">
                  {sent.map((o) => (
                    <li
                      key={o.session_id}
                      className="flex items-baseline gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm"
                    >
                      <span className="font-semibold text-zinc-900">{invoiceNo(o.invoice_number)}</span>
                      <span className="truncate text-zinc-600">{o.name || o.email}</span>
                      <span className="ml-auto whitespace-nowrap text-xs text-zinc-400">
                        sent {when(o.packed_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function OrderCard({ order: o, busy, onPack }) {
  const addr = o.address || {};
  // The shop records HOW it decided an address was rural, because Craig has to
  // know whether to trust it before he books the ticket. Shown for the same
  // reason here.
  const ruralNote =
    addr.rural && addr.ruralWhy === "declared" ? "customer ticked the rural box"
    : addr.rural && addr.ruralWhy === "address" ? "RD number in the address"
    : addr.rural ? "rural postcode"
    : null;

  return (
    <li className="rounded-xl border border-zinc-200 border-l-[3px] border-l-red-600 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-extrabold text-zinc-900">{invoiceNo(o.invoice_number)}</span>
        <span className="text-sm font-semibold text-zinc-800">{o.name || o.email || "No name"}</span>
        <span className="ml-auto whitespace-nowrap text-xs text-zinc-500">{when(o.created_at)}</span>
      </div>

      <ul className="mt-2 space-y-0.5">
        {(o.items || []).map((it, i) => (
          <li key={i} className="text-sm text-zinc-800">
            <span className="font-semibold">{it.qty}×</span> {it.name || it.sku}
          </li>
        ))}
      </ul>

      <div className="mt-2 text-sm text-zinc-600">
        {addr.formatted || "No address recorded"}
        {addr.typed && (
          <span className="ml-1 text-xs font-semibold text-amber-700">
            — typed in by the customer, check it
          </span>
        )}
      </div>

      {ruralNote && (
        <p className="mt-1 text-xs font-semibold text-amber-700">Rural delivery — {ruralNote}</p>
      )}
      {addr.note && <p className="mt-1 text-xs text-zinc-600">Note: {addr.note}</p>}

      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
        {o.phone && <a href={`tel:${o.phone}`} className="underline">{o.phone}</a>}
        {o.email && <a href={`mailto:${o.email}`} className="underline">{o.email}</a>}
        {o.country && o.country !== "NZ" && <span className="font-semibold text-zinc-700">{o.country}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
        <div className="text-xs text-zinc-500">
          {money(o.amount_total)} paid
          {o.shipping_amount ? ` · ${money(o.shipping_amount)} freight` : ""}
        </div>
        {/* Address on the top half, pick list on the bottom, cut line between.
            Opens in its own tab so the list stays where it was. */}
        <Link
          href={`/flip-orders/${o.invoice_number}/label`}
          target="_blank"
          className="ml-auto rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Print label &amp; pick ticket
        </Link>
        <button
          onClick={onPack}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Packed and ready to send"}
        </button>
      </div>
    </li>
  );
}
