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
// The packing button is the main thing on here that writes. The database
// grants an owner UPDATE on packed_at, packed_by and (for trade orders) paid_at
// and nothing else, so even if this page were wrong it could not rewrite a
// customer's address or what they paid.
//
// TRADE ORDERS (entered by Craig at /flip-orders/new) sit in the same list.
// They differ in two ways worth seeing at the bench: who PAYS can be a
// different business from where the box GOES, and they are usually not paid
// yet — so the card says when payment is due and has a "Mark paid" button.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { tradeApi, plainDate } from "../../lib/flipTrade";

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
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from("flip_orders")
      .select("session_id, created_at, invoice_number, name, email, phone, country, address, items, amount_total, shipping_amount, packed_at, consignment_id, tracking_number, shipping_source, shipping_carrier, channel, bill_to, due_date, paid_at, emailed, placed_via, customer_ref")
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

  // Recording that a trade invoice was paid. Only ever sets it; un-marking a
  // payment is rare enough to be a job for the database, not a button.
  async function markPaid(order) {
    if (!window.confirm(`Mark FLIP-${order.invoice_number} as paid?`)) return;
    setBusy(order.session_id);
    setError(null);
    const { error: e } = await supabase
      .from("flip_orders")
      .update({ paid_at: new Date().toISOString() })
      .eq("session_id", order.session_id);
    setBusy(null);
    if (e) setError(e.message);
    await load();
  }

  async function sendInvoice(order) {
    const resend = !!order.emailed;
    if (resend && !window.confirm(`The invoice for FLIP-${order.invoice_number} has already been sent. Send it again to ${order.bill_to?.email}?`)) return;
    setBusy(order.session_id);
    setError(null);
    setNotice(null);
    const r = await tradeApi({ action: "invoice", invoice_number: order.invoice_number, resend });
    setBusy(null);
    if (!r.ok) setError(`FLIP-${order.invoice_number}: ${r.error}`);
    else setNotice(`Invoice FLIP-${order.invoice_number} emailed to ${r.to}.`);
    await load();
  }

  const toPack = orders.filter((o) => !o.packed_at);
  const sent = orders.filter((o) => o.packed_at);
  // Sent but not paid. On the bench list they'd vanish once packed, and an
  // unpaid invoice that nobody can see is money nobody chases.
  const unpaid = orders.filter((o) => o.channel === "trade" && o.packed_at && !o.paid_at);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">FLIP Orders</h1>
        <p className="text-xs text-zinc-500">from flipbikes.co.nz</p>
        {/* This page answers "what do I pack". The other one answers "is it
            working". Separate pages on purpose: the bench list has to stay a
            list of jobs, not a place to read figures off. */}
        <div className="ml-auto flex flex-wrap items-baseline gap-3">
          <Link href="/flip-orders/dealers" className="text-sm font-medium text-red-700 underline">
            Dealers
          </Link>
          <Link href="/flip-orders/trade-prices" className="text-sm font-medium text-red-700 underline">
            Trade prices
          </Link>
          <Link href="/flip-orders/reports" className="text-sm font-medium text-red-700 underline">
            Reports
          </Link>
          <Link href="/flip-orders/new" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700">
            New trade order
          </Link>
        </div>
      </div>

      {notice && (
        <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>
      )}

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
                    onPaid={() => markPaid(o)}
                    onSend={() => sendInvoice(o)}
                  />
                ))}
              </ul>
            )}
          </section>

          {unpaid.length > 0 && (
            <section className="mt-6">
              <p className="mb-1.5 ml-0.5 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400">
                Sent, awaiting payment ({unpaid.length})
              </p>
              <ul className="space-y-1">
                {unpaid.map((o) => (
                  <li key={o.session_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm">
                    <span className="font-semibold text-zinc-900">{invoiceNo(o.invoice_number)}</span>
                    <span className="truncate text-zinc-600">{o.bill_to?.business || o.name}</span>
                    <span className="text-zinc-900">{money(o.amount_total)}</span>
                    <DueNote order={o} />
                    {!o.emailed && <span className="text-xs font-semibold text-amber-700">invoice not emailed</span>}
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => sendInvoice(o)} disabled={busy === o.session_id}
                        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                        {o.emailed ? "Resend invoice" : "Email invoice"}
                      </button>
                      <button onClick={() => markPaid(o)} disabled={busy === o.session_id}
                        className="rounded-lg border border-green-600 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50">
                        Mark paid
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

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
                  {/* A sent order is finished, not gone. Its consignment number is
                      what answers "where is my parcel" three weeks later, so the
                      row stays openable rather than being a dead line of text. */}
                  {sent.map((o) => (
                    <li key={o.session_id}>
                      <Link
                        href={`/flip-orders/${o.invoice_number}/label`}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                      >
                        <span className="font-semibold text-zinc-900">{invoiceNo(o.invoice_number)}</span>
                        <span className="truncate text-zinc-600">{o.name || o.email}</span>
                        {o.tracking_number && (
                          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700">
                            {o.tracking_number}
                          </span>
                        )}
                        <span className="ml-auto whitespace-nowrap text-xs text-zinc-400">
                          sent {when(o.packed_at)}
                        </span>
                      </Link>
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

// "due 20 Dec 2026", or "OVERDUE since …" once that date has passed in NZ.
function DueNote({ order: o }) {
  if (o.paid_at) return <span className="text-xs font-semibold text-green-700">paid</span>;
  if (!o.due_date) return <span className="text-xs text-zinc-500">awaiting payment</span>;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
  return o.due_date < today
    ? <span className="text-xs font-semibold text-red-700">overdue — was due {plainDate(o.due_date)}</span>
    : <span className="text-xs text-zinc-500">due {plainDate(o.due_date)}</span>;
}

function OrderCard({ order: o, busy, onPack, onPaid, onSend }) {
  const addr = o.address || {};
  const trade = o.channel === "trade";
  // The shop records HOW it decided an address was rural, because Craig has to
  // know whether to trust it before he books the ticket. Shown for the same
  // reason here.
  const ruralNote =
    addr.rural && trade ? "marked rural on the trade order"
    : addr.rural && addr.ruralWhy === "declared" ? "customer ticked the rural box"
    : addr.rural && addr.ruralWhy === "address" ? "RD number in the address"
    : addr.rural ? "rural postcode"
    : null;

  return (
    <li className="rounded-xl border border-zinc-200 border-l-[3px] border-l-red-600 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-extrabold text-zinc-900">{invoiceNo(o.invoice_number)}</span>
        {trade && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Trade</span>
        )}
        {o.placed_via === "portal" && (
          <span className="rounded bg-yellow-300 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-900">Ordered online</span>
        )}
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

      {trade && o.bill_to && (
        <p className="mt-1 text-xs text-zinc-600">
          Bill to <b>{o.bill_to.business}</b>{o.bill_to.contact ? ` (${o.bill_to.contact})` : ""}
          {o.bill_to.email ? ` · ${o.bill_to.email}` : ""}
          {o.customer_ref ? ` · their ref ${o.customer_ref}` : ""}
        </p>
      )}

      <div className="mt-2 text-sm text-zinc-600">
        {addr.collect ? <b>Customer collects from the workshop</b> : (addr.formatted || "No address recorded")}
        {addr.typed && !trade && (
          <span className="ml-1 text-xs font-semibold text-amber-700">
            — typed in by the customer, check it
          </span>
        )}
      </div>

      {ruralNote && (
        <p className="mt-1 text-xs font-semibold text-amber-700">Rural delivery — {ruralNote}</p>
      )}
      {addr.note && <p className="mt-1 text-xs text-zinc-600">Note: {addr.note}</p>}

      {/* The freight fallback is SILENT by design — a carrier outage must never
          cost a sale, so the table answers and the customer sees a price. The
          cost of that is nobody knowing it happened. On an order being packed
          by someone who was not here when it was built, "the carrier did not
          price this" is worth a line of its own. */}
      {o.shipping_source === "table" && (
        <p className="mt-1 text-xs font-semibold text-amber-700">
          Freight priced from our rate table — the carrier did not quote this one.
          Check the ticket price before you send it.
        </p>
      )}

      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500">
        {o.phone && <a href={`tel:${o.phone}`} className="underline">{o.phone}</a>}
        {o.email && <a href={`mailto:${o.email}`} className="underline">{o.email}</a>}
        {o.country && o.country !== "NZ" && <span className="font-semibold text-zinc-700">{o.country}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
        <div className="text-xs text-zinc-500">
          {money(o.amount_total)} {trade ? "invoiced" : "paid"}
          {o.shipping_amount ? ` · ${money(o.shipping_amount)} freight` : ""}
          {o.shipping_carrier ? ` (${o.shipping_carrier})` : ""}
          {trade && <> · <DueNote order={o} /></>}
          {trade && !o.emailed && <span className="font-semibold text-amber-700"> · invoice not emailed</span>}
        </div>
        {trade && (
          <div className="flex gap-2">
            <button onClick={onSend} disabled={busy}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
              {o.emailed ? "Resend invoice" : "Email invoice"}
            </button>
            {!o.paid_at && (
              <button onClick={onPaid} disabled={busy}
                className="rounded-lg border border-green-600 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50">
                Mark paid
              </button>
            )}
          </div>
        )}
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
          {busy ? "Saving…" : addr.collect ? "Packed, ready for collection" : "Packed and ready to send"}
        </button>
      </div>
    </li>
  );
}
