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
// UNTIL THERE IS A CARRIER ACCOUNT
//
// There is no GoSweetSpot account yet, so there is no courier label to print.
// The top half is OUR OWN address block, and Craig sticks the courier ticket
// on it exactly as he does today — but the address is printed rather than
// copied by hand, which is the bit that goes wrong. FLIP-1004's "DELIVER TO
// SITE STORES" is precisely the instruction a hand-copied address loses.
//
// When the account exists, the top half becomes the real carrier label and
// nothing else on this page changes.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabaseClient";

const money = (cents) => "$" + (Number(cents || 0) / 100).toFixed(2);

const BUSINESS = {
  name: "Betterservice ATV",
  lines: ["556 Te Puke Highway", "Te Puke 3183"],
  phone: "021 0832 7787",
};

export default function LabelSheetPage() {
  const { invoice } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error: e } = await supabase
        .from("flip_orders")
        .select("session_id, created_at, invoice_number, name, email, phone, country, address, items, amount_total, shipping_amount, packed_at, consignment_id, tracking_number")
        .eq("invoice_number", Number(invoice))
        .maybeSingle();
      if (e) setError(e.message);
      else if (!data) setError(`No order numbered FLIP-${invoice}.`);
      else setOrder(data);
      setLoading(false);
    })();
  }, [invoice]);

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

        {order.tracking_number && (
          <p className="mb-3 text-sm print:hidden">
            <span className="text-zinc-500">Consignment </span>
            <span className="font-mono font-semibold">{order.tracking_number}</span>
          </p>
        )}

        <p className="mb-4 text-xs text-zinc-500 print:hidden">
          Cut along the dashed line. Tape the top half to the box and stick the courier
          ticket on it; keep the bottom half with the order while you pack.
          If the printed page has a web address and a date in the margins, untick
          “Headers and footers” in the print dialog — it stays off after that.
        </p>

        <div
          id="sheet"
          className="mx-auto bg-white text-black shadow-sm print:shadow-none"
          style={{ width: "210mm", height: "297mm" }}
        >
          {/* ---------------------------------------------- top half: where it goes */}
          <div style={{ height: "148.5mm", padding: "14mm 14mm 6mm" }} className="flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9pt] font-bold uppercase tracking-[0.18em] text-zinc-500">Deliver to</p>
                <p className="mt-2 text-[20pt] font-extrabold leading-tight">{order.name || "—"}</p>
                <div className="mt-1 text-[14pt] leading-snug">
                  {addressLines.length
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
                <p className="font-semibold text-black">{BUSINESS.name}</p>
                {BUSINESS.lines.map((l) => <p key={l}>{l}</p>)}
                <p>Ph {BUSINESS.phone}</p>
              </div>
              <p className="text-right">Stick the courier ticket on this half</p>
            </div>
          </div>

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
            <p className="text-[10pt] text-zinc-600">{a.formatted || "No address recorded"}</p>
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
                  : `Freight charged ${money(order.shipping_amount)} of ${money(order.amount_total)} paid`}
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
