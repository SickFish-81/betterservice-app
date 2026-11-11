"use client";

// New FLIP trade order — a sale Craig enters himself, at trade prices.
//
// A dealer rings or emails: "ten Standards, sent to our customer in Gore."
// This is where that becomes an order. It goes into the same list the shop's
// orders go into, gets the next FLIP number, takes the stock off the same
// shelf count, prints the same label and pick sheet, and sends an invoice built
// by the same code that builds the shop's.
//
// What is different, and why:
//
//   * Prices EXCLUDE GST, because that is how trade is quoted. GST is added
//     once on the total — by the database, not by this page.
//   * The person who pays (BILL TO) and the place it goes (DELIVER TO) are
//     separate, so a dealer can have it sent straight to their own customer.
//   * Freight is the courier's COST, no markup, from flipbikes.co.nz's
//     owner-only quote. Craig can change it before saving.
//   * It is not paid yet (usually). The invoice says when and how to pay, and
//     the order list shows it as awaiting payment until he marks it paid.
//
// This page cannot set a total. It sends quantities, prices and freight; the
// database works out GST and the total and refuses anything it doesn't like.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import {
  money, parseCents, centsToInput, gstOn, twentiethOfNextMonth, plainDate, tradeApi,
} from "../../../lib/flipTrade";

const ORDER = ["flip-standard", "flip-g3", "flip-road", "flip-starter-pack", "tie-downs", "d-rings"];
const input = "w-full rounded-lg border border-zinc-300 px-2.5 py-2 text-sm text-zinc-900";
const card = "rounded-xl border border-zinc-200 bg-white p-4 shadow-sm";
const heading = "mb-3 text-[10px] font-bold uppercase tracking-[0.09em] text-zinc-400";

function Field({ label, required, children, hint }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-600">
        {label}{required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-zinc-400">{hint}</span>}
    </label>
  );
}

export default function NewFlipTradeOrderPage() {
  const [products, setProducts] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [tierPrices, setTierPrices] = useState([]);
  const [dealerId, setDealerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [bill, setBill] = useState({ business: "", contact: "", email: "", phone: "", address: "" });
  const [collect, setCollect] = useState(false);
  const [ship, setShip] = useState({ name: "", phone: "", line1: "", suburb: "", city: "", postcode: "", note: "", rural: false });
  const [qty, setQty] = useState({});      // sku -> text
  const [price, setPrice] = useState({});  // sku -> text, ex GST

  const [freight, setFreight] = useState("");   // text, ex GST
  const [quote, setQuote] = useState(null);     // last answer from /api/trade
  const [quotedFor, setQuotedFor] = useState(null);
  const [quoting, setQuoting] = useState(false);

  const [dueDate, setDueDate] = useState(twentiethOfNextMonth());
  const [paid, setPaid] = useState(false);
  const [emailNow, setEmailNow] = useState(true);

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);       // { invoice_number, ... }
  const [sendError, setSendError] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data, error: e }, dl, tp] = await Promise.all([
        supabase.from("flip_trade_prices").select("sku, name, price_ex_gst"),
        supabase.from("flip_dealers").select("id, business, contact, email, phone, address, tier_id").order("business"),
        supabase.from("flip_tier_prices").select("tier_id, sku, price_ex_gst"),
      ]);
      if (e || dl.error || tp.error) setError((e || dl.error || tp.error).message);
      setDealers(dl.data || []);
      setTierPrices(tp.data || []);
      const sorted = (data || []).slice().sort((a, b) => ORDER.indexOf(a.sku) - ORDER.indexOf(b.sku));
      setProducts(sorted);
      setPrice(Object.fromEntries(sorted.map((p) => [p.sku, centsToInput(p.price_ex_gst)])));
      setLoading(false);
    })();
  }, []);

  // The price a product starts at on this order: the chosen dealer's tier
  // where it has one, Standard otherwise.
  const dealer = dealers.find((d) => d.id === dealerId) || null;
  const startPrice = (p) => {
    const t = dealer && tierPrices.find((x) => x.tier_id === dealer.tier_id && x.sku === p.sku);
    return t ? t.price_ex_gst : p.price_ex_gst;
  };

  function pickDealer(id) {
    setDealerId(id);
    const d = dealers.find((x) => x.id === id);
    if (d) {
      setBill({ business: d.business || "", contact: d.contact || "", email: d.email || "", phone: d.phone || "", address: d.address || "" });
    }
    setPrice(Object.fromEntries(products.map((p) => {
      const t = d && tierPrices.find((x) => x.tier_id === d.tier_id && x.sku === p.sku);
      return [p.sku, centsToInput(t ? t.price_ex_gst : p.price_ex_gst)];
    })));
  }

  // ---------------------------------------------------------- the order lines
  const lines = useMemo(() => products
    .map((p) => {
      const qText = String(qty[p.sku] ?? "").trim();
      if (qText === "" || qText === "0") return null;
      const q = /^\d+$/.test(qText) ? Number(qText) : NaN;
      const unit = parseCents(price[p.sku]);
      return { sku: p.sku, name: p.name, qty: q, unit };
    })
    .filter(Boolean), [products, qty, price]);

  const lineProblems = lines
    .map((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 1000
      ? `Quantity for ${l.name} must be a whole number from 1 to 1000.`
      : l.unit === null ? `Type a price for ${l.name}.` : null)
    .filter(Boolean);

  const goods = lines.reduce((s, l) => s + (Number.isInteger(l.qty) && l.unit !== null ? l.qty * l.unit : 0), 0);
  const freightCents = collect ? 0 : parseCents(freight);
  const exTotal = goods + (freightCents || 0);
  const gst = gstOn(exTotal);
  const total = exTotal + gst;

  // A courier quote is for one address and one set of boxes. Change either and
  // the figure on screen no longer means what it says, so it is marked stale.
  const quoteKey = JSON.stringify({
    a: [ship.line1, ship.suburb, ship.city, ship.postcode].map((s) => s.trim().toLowerCase()),
    r: ship.rural,
    l: lines.map((l) => [l.sku, l.qty]),
  });
  const quoteStale = quote && quotedFor !== quoteKey;

  async function getQuote() {
    setError(null);
    if (lines.length === 0 || lineProblems.length) { setError("Add the products first — the box size decides the freight."); return; }
    if (!ship.line1.trim() || !ship.city.trim() || !/^\d{4}$/.test(ship.postcode.trim())) {
      setError("Fill in the street, town or city and a 4-digit postcode first.");
      return;
    }
    setQuoting(true);
    const r = await tradeApi({
      action: "quote",
      items: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
      address: { manual: { line1: ship.line1.trim(), suburb: ship.suburb.trim(), city: ship.city.trim(), postcode: ship.postcode.trim() } },
      ruralDeclared: ship.rural,
    });
    setQuoting(false);
    if (!r.ok) { setError(r.error); return; }
    setQuote(r);
    setQuotedFor(quoteKey);
    setFreight(centsToInput(r.shipping_ex_gst));
  }

  // ------------------------------------------------------------------- checks
  const problems = [];
  if (!bill.business.trim()) problems.push("Enter the trade customer's business name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bill.email.trim())) problems.push("Enter the email address the invoice goes to.");
  if (!collect) {
    if (!ship.name.trim() || !ship.line1.trim() || !ship.city.trim()) problems.push("Fill in who it's going to, the street and the town or city.");
    if (!/^\d{4}$/.test(ship.postcode.trim())) problems.push("The delivery postcode must be 4 digits.");
    if (freightCents === null) problems.push("Enter the freight (get the courier cost, or type 0 for free freight).");
  }
  if (lines.length === 0) problems.push("Add at least one product.");
  problems.push(...lineProblems);
  if (!paid && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) problems.push("Set the date payment is due.");

  async function sendInvoice(invoiceNumber, resend = false) {
    setSending(true);
    setSendError(null);
    const r = await tradeApi({ action: "invoice", invoice_number: invoiceNumber, resend });
    setSending(false);
    if (!r.ok) { setSendError(r.error); return false; }
    setDone((d) => ({ ...d, sentTo: r.to, copied: r.copied }));
    return true;
  }

  async function create() {
    setError(null);
    if (problems.length) { setError(problems[0]); return; }
    setSaving(true);

    const usedQuote = quote && !quoteStale && !collect;
    const p_order = {
      dealer_id: dealer ? dealer.id : null,
      bill_to: {
        business: bill.business.trim(), contact: bill.contact.trim(), email: bill.email.trim(),
        phone: bill.phone.trim(), address: bill.address.trim(),
      },
      collect,
      deliver_to: collect ? { note: ship.note.trim() } : {
        name: ship.name.trim(), phone: ship.phone.trim(), line1: ship.line1.trim(), suburb: ship.suburb.trim(),
        city: ship.city.trim(), postcode: ship.postcode.trim(), note: ship.note.trim(), rural: ship.rural,
      },
      lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, unit_ex_gst: l.unit })),
      shipping_ex_gst: collect ? 0 : freightCents,
      // What the courier QUOTED, recorded beside what was charged, so the
      // reports can show the difference if Craig changed it.
      shipping_source: usedQuote ? quote.source : null,
      shipping_carrier: usedQuote ? quote.carrier : null,
      shipping_quoted_cents: usedQuote ? quote.quoted_cents : null,
      due_date: paid ? null : dueDate,
      paid,
    };

    const { data, error: e } = await supabase.rpc("create_flip_trade_order", { p_order });
    if (e) { setSaving(false); setError(e.message); return; }
    setDone(data);
    setSaving(false);
    if (emailNow) await sendInvoice(data.invoice_number);
  }

  // ------------------------------------------------------------------ done
  if (done) {
    const empty = Object.entries(done.stock_left || {}).filter(([, n]) => n === 0)
      .map(([sku]) => products.find((p) => p.sku === sku)?.name || sku);
    return (
      <main className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
        <div className={`${card} border-l-[3px] border-l-green-600`}>
          <p className="text-lg font-extrabold text-zinc-900">FLIP-{done.invoice_number} created</p>
          <p className="mt-1 text-sm text-zinc-600">
            {money(done.amount_ex_gst)} + GST {money(done.gst_amount)} = <b>{money(done.amount_total)}</b>
          </p>
          {sending && <p className="mt-2 text-sm text-zinc-600">Emailing the invoice…</p>}
          {done.sentTo && (
            <p className="mt-2 text-sm text-green-800">
              Invoice emailed to {done.sentTo}.{done.copied === false && " Your copy didn't send, but the customer's did."}
            </p>
          )}
          {!done.sentTo && !emailNow && !sendError && (
            <p className="mt-2 text-sm text-zinc-600">The invoice hasn't been emailed. Send it from the order list when you're ready.</p>
          )}
          {sendError && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              The order is saved, but the invoice didn't send: {sendError}
              <button
                onClick={() => sendInvoice(done.invoice_number)}
                disabled={sending}
                className="ml-2 font-semibold underline disabled:opacity-50"
              >
                {sending ? "Sending…" : "Try again"}
              </button>
            </div>
          )}
          {empty.length > 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-700">
              The stock count for {empty.join(", ")} is now 0 — check the shelf before it's packed.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/flip-orders/${done.invoice_number}/label`} target="_blank"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              Print label &amp; pick ticket
            </Link>
            <Link href="/flip-orders" className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">
              Back to FLIP orders
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------------ form
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <Link href="/flip-orders" className="text-sm text-zinc-600 underline">← FLIP orders</Link>
      <h1 className="mt-3 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">New trade order</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Prices exclude GST. GST is added once on the total. <Link href="/flip-orders/trade-prices" className="underline">Trade prices</Link>
      </p>

      {loading ? <p className="mt-6 text-zinc-500">Loading…</p> : (
        <div className="mt-5 space-y-4">
          {/* --------------------------------------------------- bill to */}
          <section className={card}>
            <p className={heading}>Bill to — who pays and gets the invoice</p>
            {dealers.length > 0 && (
              <div className="mb-3">
                <Field label="Saved dealer" hint={dealer ? "Details and prices filled in from the dealer. Change anything for this order only." : "Pick one to fill in their details and price tier, or type a new customer below."}>
                  <select className={input} value={dealerId} onChange={(e) => pickDealer(e.target.value)}>
                    <option value="">— New or one-off customer —</option>
                    {dealers.map((d) => <option key={d.id} value={d.id}>{d.business}</option>)}
                  </select>
                </Field>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business" required>
                <input className={input} value={bill.business} onChange={(e) => setBill({ ...bill, business: e.target.value })} />
              </Field>
              <Field label="Contact name">
                <input className={input} value={bill.contact} onChange={(e) => setBill({ ...bill, contact: e.target.value })} />
              </Field>
              <Field label="Email for the invoice" required>
                <input type="email" className={input} value={bill.email} onChange={(e) => setBill({ ...bill, email: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className={input} value={bill.phone} onChange={(e) => setBill({ ...bill, phone: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Billing address" hint="Printed on the invoice. One line, e.g. 12 Main Street, Hamilton 3200">
                  <input className={input} value={bill.address} onChange={(e) => setBill({ ...bill, address: e.target.value })} />
                </Field>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------- deliver to */}
          <section className={card}>
            <p className={heading}>Deliver to — where the box goes</p>
            <label className="mb-3 flex items-center gap-2 text-sm text-zinc-800">
              <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
              Customer collects from the workshop (no freight)
            </label>
            {!collect && (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button type="button"
                    onClick={() => setShip({ ...ship, name: bill.contact ? `${bill.business} (${bill.contact})` : bill.business, phone: bill.phone })}
                    className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50">
                    Send to the bill-to business
                  </button>
                  <span className="self-center text-xs text-zinc-400">or fill in their customer's details to send it direct</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name on the label" required>
                    <input className={input} value={ship.name} onChange={(e) => setShip({ ...ship, name: e.target.value })} />
                  </Field>
                  <Field label="Phone" hint="The courier uses it if they can't find the place">
                    <input className={input} value={ship.phone} onChange={(e) => setShip({ ...ship, phone: e.target.value })} />
                  </Field>
                  <Field label="Street address" required>
                    <input className={input} value={ship.line1} onChange={(e) => setShip({ ...ship, line1: e.target.value })} />
                  </Field>
                  <Field label="Suburb">
                    <input className={input} value={ship.suburb} onChange={(e) => setShip({ ...ship, suburb: e.target.value })} />
                  </Field>
                  <Field label="Town or city" required>
                    <input className={input} value={ship.city} onChange={(e) => setShip({ ...ship, city: e.target.value })} />
                  </Field>
                  <Field label="Postcode" required>
                    <input inputMode="numeric" maxLength={4} className={input} value={ship.postcode} onChange={(e) => setShip({ ...ship, postcode: e.target.value })} />
                  </Field>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-zinc-800">
                  <input type="checkbox" checked={ship.rural} onChange={(e) => setShip({ ...ship, rural: e.target.checked })} />
                  Rural delivery address
                </label>
              </>
            )}
            <div className="mt-3">
              <Field label={collect ? "Note" : "Delivery instructions"} hint={collect ? undefined : "Printed big on the label, e.g. Leave at the shed"}>
                <input className={input} value={ship.note} onChange={(e) => setShip({ ...ship, note: e.target.value })} />
              </Field>
            </div>
          </section>

          {/* --------------------------------------------------- products */}
          <section className={card}>
            <p className={heading}>Products — prices excluding GST</p>
            <div className="space-y-2">
              {products.map((p) => {
                const unit = parseCents(price[p.sku]);
                const q = Number(qty[p.sku] || 0);
                const base = startPrice(p);
                const changed = base !== null && unit !== null && unit !== base;
                return (
                  <div key={p.sku} className="flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-2 last:border-0">
                    <span className="min-w-0 flex-1 text-sm text-zinc-900">{p.name}</span>
                    <input
                      inputMode="numeric" placeholder="0" aria-label={`Quantity of ${p.name}`}
                      value={qty[p.sku] ?? ""} onChange={(e) => setQty({ ...qty, [p.sku]: e.target.value })}
                      className="w-16 rounded-lg border border-zinc-300 px-2 py-1.5 text-right text-sm"
                    />
                    <span className="text-xs text-zinc-400">×</span>
                    <label className="flex items-center gap-1 text-sm text-zinc-500">
                      $
                      <input
                        inputMode="decimal" placeholder="price" aria-label={`Price of ${p.name} excluding GST`}
                        value={price[p.sku] ?? ""} onChange={(e) => setPrice({ ...price, [p.sku]: e.target.value })}
                        className={`w-24 rounded-lg border px-2 py-1.5 text-right text-sm ${changed ? "border-amber-400 bg-amber-50" : "border-zinc-300"}`}
                      />
                    </label>
                    <span className="w-20 text-right text-sm font-medium text-zinc-900">
                      {q > 0 && unit !== null ? money(q * unit) : ""}
                    </span>
                    {changed && (
                      <span className="w-full text-right text-[11px] text-amber-700">
                        {dealer ? `${dealer.business}'s price` : "List price"} is {money(base)} — this order only
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---------------------------------------------------- freight */}
          {!collect && (
            <section className={card}>
              <p className={heading}>Freight — charged at cost, excluding GST</p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={getQuote} disabled={quoting}
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
                  {quoting ? "Asking the courier…" : quote ? "Get courier cost again" : "Get courier cost"}
                </button>
                <label className="flex items-center gap-1 text-sm text-zinc-500">
                  $
                  <input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0.00"
                    className="w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-right text-sm text-zinc-900" />
                  <span className="text-xs">ex GST</span>
                </label>
              </div>
              {quote && !quoteStale && quote.source === "carrier" && (
                <p className="mt-2 text-xs text-zinc-600">
                  {quote.carrier || "Courier"} cost {money(quote.quoted_cents)} ex GST
                  {quote.rural ? " · rural delivery" : ""}
                  {freightCents !== null && freightCents !== quote.quoted_cents && (
                    <span className="font-semibold text-amber-700"> · you've changed it to {money(freightCents)}</span>
                  )}
                </p>
              )}
              {quote && !quoteStale && quote.warning && (
                <p className="mt-2 text-xs font-semibold text-amber-700">{quote.warning}</p>
              )}
              {quoteStale && (
                <p className="mt-2 text-xs font-semibold text-amber-700">
                  The address or products have changed since that quote. Get the courier cost again.
                </p>
              )}
            </section>
          )}

          {/* ---------------------------------------------------- payment */}
          <section className={card}>
            <p className={heading}>Payment</p>
            <label className="flex items-center gap-2 text-sm text-zinc-800">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              Already paid
            </label>
            {!paid && (
              <div className="mt-3 max-w-xs">
                <Field label="Payment due" hint={`Printed on the invoice: ${plainDate(dueDate)}`}>
                  <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
              </div>
            )}
            <label className="mt-3 flex items-center gap-2 text-sm text-zinc-800">
              <input type="checkbox" checked={emailNow} onChange={(e) => setEmailNow(e.target.checked)} />
              Email the invoice to {bill.email.trim() || "the customer"} now
            </label>
          </section>

          {/* ----------------------------------------------------- totals */}
          <section className={`${card} sticky bottom-3`}>
            <div className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <span className="text-zinc-600">Products</span><span className="text-right">{money(goods)}</span>
              {!collect && (<><span className="text-zinc-600">Freight</span><span className="text-right">{freightCents === null ? "—" : money(freightCents)}</span></>)}
              <span className="text-zinc-600">Subtotal excluding GST</span><span className="text-right">{money(exTotal)}</span>
              <span className="text-zinc-600">GST 15%</span><span className="text-right">{money(gst)}</span>
              <span className="font-bold text-zinc-900">Total including GST</span><span className="text-right font-bold">{money(total)}</span>
            </div>
            {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
            <button onClick={create} disabled={saving || problems.length > 0}
              className="mt-3 w-full rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40">
              {saving ? "Saving…" : emailNow ? "Create order and email invoice" : "Create order"}
            </button>
            {problems.length > 0 && !error && (
              <p className="mt-2 text-center text-xs text-zinc-500">{problems[0]}</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
