"use client";

// One A4 sheet: where it's going on the top half, what goes in the box on the
// bottom half, a cut line between them.
//
// WHY THIS IS A PAGE AND NOT A PRINT AGENT
//
// It was going to be a daemon on a Mac in the workshop, polling for labels and
// printing them unattended. Built, and it worked — but the shop does four or
// five orders a MONTH, and Craig is already standing in this app pressing
// "Packed and ready to send" on every one of them. A background service, a
// shared secret, a Terminal window that must stay open and a Mac that must
// never sleep is a lot of machinery to save one click five times a month, and
// every piece of it is another way for a label to quietly not exist.
//
// It also makes the printer's worst habit harmless. The Brother sleeps deeply
// enough to accept jobs and print none of them while reporting nothing wrong —
// which is invisible to a daemon and obvious to a man standing at the printer
// watching nothing come out.
//
// WHY HTML AND NOT A PDF
//
// The invoice is a PDF because the customer receives it and the file has to be
// the same artefact we sent. Nothing receives this: it is a picking sheet that
// gets cut in half and thrown away. HTML means the browser handles the fonts
// (so a macron in a customer's name can't break it, which it has before), one
// copy of the layout instead of two, and the carrier label drops in as an
// <img> the day there is one.
//
// THE COURIER LABEL
//
// "Book courier" (above the sheet, never printed) asks flipbikes.co.nz to book
// the parcel with GoSweetSpot — NZ Post, the one carrier that collects from the
// workshop — and file the label. Once there is one, the top half IS the
// GoSweetSpot label. Until then, or for anything that can't be booked from here
// (collections, overseas), the top half is our own address block and Craig
// sticks a hand-made ticket on it, as before.
//
// An order already marked sent with no booking was ticketed by hand, so the
// button is not offered for it — and the server refuses it too.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabaseClient";
import { tradeApi } from "../../../../lib/flipTrade";

const COLS = "session_id, created_at, invoice_number, name, email, phone, country, address, items, amount_total, shipping_amount, packed_at, consignment_id, tracking_number, label_fetched_at, label_error, shipping_carrier, channel, bill_to, paid_at, shipping_ex_gst";

const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);

const BUSINESS = {
  name: "Betterservice ATV",
  lines: ["556 Te Puke Highway", "Te Puke 3187"],
  phone: "021 0832 7787",
};

export default function LabelSheetPage() {
  const { invoice } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [labelSrc, setLabelSrc] = useState(null);   // data: URL of the GSS label
  const [labelMsg, setLabelMsg] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookErr, setBookErr] = useState(null);

  async function load() {
    const { data, error: e } = await supabase
      .from("flip_orders")
      .select(COLS)
      .eq("invoice_number", Number(invoice))
      .maybeSingle();
    if (e) { setError(e.message); return null; }
    if (!data) { setError(`No order numbered FLIP-${invoice}.`); return null; }
    setOrder(data);
    return data;
  }

  async function fetchLabel() {
    const r = await tradeApi({ action: "label", invoice_number: Number(invoice) });
    if (r.ok && r.png) { setLabelSrc(`data:image/png;base64,${r.png}`); setLabelMsg(null); }
    else setLabelMsg(r.error || "Couldn't load the courier label.");
  }

  useEffect(() => {
    (async () => {
      const o = await load();
      setLoading(false);
      if (o?.consignment_id && o?.label_fetched_at) fetchLabel();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  async function book() {
    setBooking(true); setBookErr(null); setConfirming(false);
    const r = await tradeApi({ action: "book", invoice_number: Number(invoice) });
    const o = await load();
    if (!r.ok) setBookErr(r.error || "The booking didn't go through.");
    if (o?.consignment_id && o?.label_fetched_at) await fetchLabel();
    setBooking(false);
  }

  if (loading) return <main className="p-6 text-zinc-500">Loading…</main>;
  if (error) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        <Link href="/flip-orders" className="mt-4 inline-block text-sm underline">Back to FLIP orders</Link>
      </main>
    );
  }

  const a = order.address || {};
  const trade = order.channel === "trade";
  // A trade order the customer picks up has no address and no courier. The
  // sheet still prints — it is the pick list — but the top half says who is
  // collecting instead of pretending there's somewhere to send it.
  const collect = !!a.collect;
  // Dropship: the box goes to the dealer's customer, so the sender on our
  // half of the label is the DEALER — their customer bought from them.
  // (The courier's own ticket still carries the GoSweetSpot sender.)
  const dropship = trade && !collect && order.bill_to?.business && order.bill_to.business !== order.name;
  const sender = dropship
    ? { name: order.bill_to.business, lines: [], phone: order.bill_to.phone || null }
    : BUSINESS;
  // What the booking panel can offer. Mirrors what the server will accept;
  // the server is the one that actually decides.
  const overseas = !!order.country && order.country !== "NZ";
  const booked = !!order.consignment_id;
  const handTicketed = !booked && !!order.packed_at;
  const canBook = !collect && !overseas && !booked && !order.packed_at;
  const needsLabel = booked && !order.label_fetched_at;
  const addressLines = (a.formatted || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <>
      {/* Only the sheet reaches the paper. Hiding everything and then
          un-hiding the sheet is clumsier than it looks but it is the one
          approach that survives the app's nav, banners and anything else a
          layout puts on the page. */}
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          body * { visibility: hidden !important; }
          #sheet, #sheet * { visibility: visible !important; }
          #sheet { position: absolute; left: 0; top: 0; margin: 0; box-shadow: none; }
        }
      `}</style>

      <main className="mx-auto max-w-[230mm] px-4 py-6 print:p-0">
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <Link href="/flip-orders" className="text-sm text-zinc-600 underline">← FLIP orders</Link>
          <button
            onClick={() => window.print()}
            className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Print this sheet
          </button>
        </div>

        {/* ------------------------------------------------ the courier booking */}
        <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm print:hidden">
          {booked ? (
            <p>
              <span className="font-semibold text-green-700">Courier booked</span>
              <span className="text-zinc-500"> · consignment </span>
              <span className="font-mono font-semibold">{order.tracking_number}</span>
              {order.shipping_carrier && <span className="text-zinc-500"> · {order.shipping_carrier}</span>}
            </p>
          ) : collect ? (
            <p className="text-zinc-600">Collection — no courier to book.</p>
          ) : overseas ? (
            <p className="text-zinc-600">Overseas order — ticket this one by hand in GoSweetSpot.</p>
          ) : handTicketed ? (
            <p className="text-zinc-600">Already marked as sent without a GoSweetSpot booking (ticketed by hand), so it can&apos;t be booked from here.</p>
          ) : (
            <p className="text-zinc-600">Not booked yet. Booking pays for an NZ Post courier on the GoSweetSpot account and puts its label on this sheet.</p>
          )}

          {canBook && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={booking}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50">
                  {booking ? "Booking…" : order.label_error ? "Try booking again" : "Book courier with GoSweetSpot"}
                </button>
              ) : (
                <>
                  <button onClick={book} disabled={booking}
                    className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    Yes, book and pay for it
                  </button>
                  <button onClick={() => setConfirming(false)} disabled={booking}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-white">
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}

          {needsLabel && (
            <div className="mt-2">
              <p className="text-amber-800">Booked, but the label didn&apos;t come through yet. This only fetches the label — it won&apos;t book a second courier.</p>
              <button onClick={book} disabled={booking}
                className="mt-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50">
                {booking ? "Fetching…" : "Get the label"}
              </button>
            </div>
          )}

          {(bookErr || (order.label_error && !booked)) && (
            <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-red-800">
              {bookErr || order.label_error}
            </p>
          )}
          {labelMsg && <p className="mt-2 text-amber-800">{labelMsg}</p>}
        </div>

        <p className="mb-4 text-xs text-zinc-500 print:hidden">
          {labelSrc
            ? "Cut along the dashed line. Tape the courier label on the top half to the box; keep the bottom half with the order while you pack."
            : "Cut along the dashed line. Tape the top half to the box and stick the courier ticket on it; keep the bottom half with the order while you pack."}
          {" "}If the printed page has a web address and a date in the margins, untick
          “Headers and footers” in the print dialog — it stays off after that.
        </p>

        <div
          id="sheet"
          className="mx-auto bg-white text-black shadow-sm print:shadow-none"
          style={{ width: "210mm", height: "297mm" }}
        >
          {/* ---------------------------------------------- top half: where it goes */}
          {labelSrc ? (
          // The carrier's own label: barcode, sender, receiver, everything
          // the courier scans. Printed as large as the half allows, never
          // stretched, because a squashed barcode doesn't scan.
          <div style={{ height: "148.5mm", padding: "10mm 10mm 6mm" }} className="flex flex-col items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={labelSrc} alt={`Courier label ${order.tracking_number || ""}`}
              style={{ maxWidth: "100%", maxHeight: "124mm", objectFit: "contain" }} />
            <p className="mt-2 text-[9pt] text-zinc-500">FLIP-{order.invoice_number} · {order.tracking_number}</p>
          </div>
          ) : (
          <div style={{ height: "148.5mm", padding: "14mm 14mm 6mm" }} className="flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9pt] font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {collect ? "For collection by" : "Deliver to"}
                </p>
                <p className="mt-2 text-[20pt] font-extrabold leading-tight">{order.name || "—"}</p>
                <div className="mt-1 text-[14pt] leading-snug">
                  {collect
                    ? <p>Customer collects from the workshop</p>
                    : addressLines.length
                      ? addressLines.map((l, i) => <p key={i}>{l}</p>)
                      : <p className="text-zinc-500">No address recorded</p>}
                </div>
                {order.phone && <p className="mt-2 text-[12pt]">Ph {order.phone}</p>}
              </div>
              <div className="text-right">
                <p className="text-[9pt] font-bold uppercase tracking-[0.18em] text-zinc-500">Order</p>
                <p className="text-[22pt] font-extrabold leading-none">FLIP-{order.invoice_number}</p>
              </div>
            </div>

            {/* The instruction a hand-copied address loses. Printed big on
                purpose — it is the whole reason this half exists. */}
            {a.note && (
              <div className="mt-5 border-y-2 border-black py-2">
                <p className="text-[9pt] font-bold uppercase tracking-[0.18em]">Delivery instructions</p>
                <p className="text-[15pt] font-bold leading-snug">{a.note}</p>
              </div>
            )}

            {a.rural && (
              <p className="mt-3 text-[11pt] font-bold uppercase tracking-wide">Rural delivery</p>
            )}

            <div className="mt-auto flex items-end justify-between border-t border-zinc-300 pt-3 text-[9pt] leading-snug text-zinc-600">
              <div>
                <p className="font-bold uppercase tracking-[0.14em] text-zinc-500">From</p>
                <p className="font-semibold text-black">{sender.name}</p>
                {sender.lines.map((l) => <p key={l}>{l}</p>)}
                {sender.phone && <p>Ph {sender.phone}</p>}
              </div>
              <p className="text-right">{collect ? "Keep this half with the box until it's collected" : "Stick the courier ticket on this half"}</p>
            </div>
          </div>
          )}

          {/* ------------------------------------------------------- the cut line */}
          <div className="relative" style={{ height: "0mm" }}>
            <div className="absolute inset-x-0 border-t border-dashed border-zinc-400" />
            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-[8pt] uppercase tracking-[0.2em] text-zinc-400">
              cut here
            </span>
          </div>

          {/* ------------------------------------------- bottom half: what goes in */}
          <div style={{ height: "148.5mm", padding: "12mm 14mm 14mm" }} className="flex flex-col">
            <div className="flex items-baseline justify-between">
              <p className="text-[18pt] font-extrabold">FLIP-{order.invoice_number}</p>
              <p className="text-[11pt] font-bold uppercase tracking-[0.16em] text-zinc-500">Pack this</p>
            </div>
            <p className="mt-1 text-[11pt] font-semibold">{order.name || order.email || "—"}</p>
            <p className="text-[10pt] text-zinc-600">
              {collect ? "Customer collects from the workshop" : (a.formatted || "No address recorded")}
            </p>
            {/* For a dropship, the packer has to know the box goes to someone
                other than the business on the invoice. */}
            {trade && order.bill_to?.business && order.bill_to.business !== order.name && (
              <p className="text-[10pt] text-zinc-600">Trade order for {order.bill_to.business}</p>
            )}
            {a.note && <p className="mt-1 text-[11pt] font-bold">{a.note}</p>}

            <ul className="mt-5 space-y-2">
              {(order.items || []).map((it, i) => (
                <li key={i} className="flex items-center gap-3 border-b border-zinc-200 pb-2">
                  <span className="inline-block h-[5mm] w-[5mm] flex-none border-2 border-black" />
                  <span className="text-[14pt] font-bold">{it.qty} ×</span>
                  <span className="text-[13pt]">{it.name || it.sku}</span>
                  <span className="ml-auto text-[9pt] text-zinc-400">{it.sku}</span>
                </li>
              ))}
            </ul>

            <div className="mt-auto flex items-end justify-between border-t border-zinc-300 pt-3 text-[9pt] text-zinc-600">
              <p>
                Ordered {new Date(order.created_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
                {order.country && order.country !== "NZ" ? ` · ${order.country}` : ""}
              </p>
              <p>
                {order.tracking_number
                  ? `Consignment ${order.tracking_number}`
                  : collect
                    ? "Collection — no freight"
                    : trade
                      // A trade invoice is often not paid when the box goes,
                      // so "of $X paid" would be untrue. The freight figure is
                      // what the packer checks the ticket against.
                      ? `Trade order · freight at cost ${money(order.shipping_ex_gst)} + GST`
                      : `Freight charged ${money(order.shipping_amount)} of ${money(order.amount_total)} paid`}
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
