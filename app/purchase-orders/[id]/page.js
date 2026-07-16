"use client";

// Betterservice — Purchase order detail + receive (Phase 3b).
// Receiving posts on ACTUAL quantities/costs, adds stock (logged), and records
// an on-account bill (Cost of Parts + input GST / Accounts Payable) in the books.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const poNo = (n) => "PO-" + String(n ?? 0).padStart(5, "0");
const expNo = (n) => "EXP-" + String(n ?? 0).padStart(5, "0");
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const STATUS_STYLES = {
  Draft: "bg-zinc-100 text-zinc-700",
  Ordered: "bg-amber-50 text-amber-700",
  Received: "bg-emerald-50 text-emerald-700",
  Cancelled: "bg-red-50 text-red-600",
};

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const [po, setPo] = useState(null);
  const [items, setItems] = useState([]);
  const [recv, setRecv] = useState({});
  const [settings, setSettings] = useState(null);
  const [gst, setGst] = useState("");
  const [gstAuto, setGstAuto] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name, email), purchase_order_items(*, parts(name), job_cards(job_number)), expenses(expense_number, amount_ex_gst, gst, total)")
      .eq("id", id)
      .single();
    if (error) { setError(error.message); setLoading(false); return; }
    setPo(data);
    const its = (data.purchase_order_items || []).slice().sort((a, b) => (a.description > b.description ? 1 : -1));
    setItems(its);
    const r = {};
    its.forEach((it) => { r[it.id] = { qty: String(it.qty_received || it.qty_ordered), cost: String(it.unit_cost) }; });
    setRecv(r);
    const { data: st } = await supabase.from("shop_settings").select("*").eq("id", 1).single();
    setSettings(st || null);
    setLoading(false);
  }
  useEffect(() => { if (id) load(); }, [id]);

  const setR = (itemId, k) => (e) => setRecv((s) => ({ ...s, [itemId]: { ...s[itemId], [k]: e.target.value } }));
  const goods = Math.round(items.reduce((s, it) => s + (Number(recv[it.id]?.qty) || 0) * (Number(recv[it.id]?.cost) || 0), 0) * 100) / 100;
  const gstVal = gstAuto ? Math.round(goods * 0.15 * 100) / 100 : (Number(gst) || 0);
  const total = Math.round((goods + gstVal) * 100) / 100;
  const orderTotal = Math.round(items.reduce((s, it) => s + Number(it.qty_ordered) * Number(it.unit_cost || 0), 0) * 100) / 100;

  async function markOrdered() { await supabase.from("purchase_orders").update({ status: "Ordered" }).eq("id", id); load(); }
  async function cancel() {
    if (!window.confirm("Cancel this order?")) return;
    await supabase.from("purchase_orders").update({ status: "Cancelled" }).eq("id", id); load();
  }

  async function emailPO() {
    setError(null); setOk(null);
    if (!po?.suppliers?.email) { setError("This supplier has no email on file — add one on the Suppliers page, then try again."); return; }
    setEmailing(true);
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF();
      let y = 20;
      doc.setFontSize(18); doc.text(settings?.business_name || "Betterservice Te Puke", 20, y); y += 7;
      doc.setFontSize(10);
      if (settings?.address) { doc.text(settings.address, 20, y); y += 5; }
      if (settings?.phone) { doc.text("Ph: " + settings.phone, 20, y); y += 5; }
      if (settings?.gst_number) { doc.text("GST #: " + settings.gst_number, 20, y); y += 5; }
      y += 5;
      doc.setFontSize(14); doc.text("PURCHASE ORDER  " + poNo(po.po_number), 20, y); y += 8;
      doc.setFontSize(10);
      doc.text("Date: " + (po.order_date || ""), 20, y); y += 6;
      doc.text("Supplier: " + (po.suppliers?.name || ""), 20, y); y += 10;
      doc.line(20, y, 190, y); y += 6;
      items.forEach((it) => {
        const desc = (it.parts?.name || it.description) + "  (" + it.qty_ordered + " x $" + Number(it.unit_cost).toFixed(2) + ")";
        doc.text(String(desc).substring(0, 70), 20, y);
        doc.text("$" + (Number(it.qty_ordered) * Number(it.unit_cost)).toFixed(2), 190, y, { align: "right" });
        y += 6;
      });
      y += 2; doc.line(120, y, 190, y); y += 6;
      doc.setFontSize(12); doc.text("Total (excl. GST)", 110, y); doc.text("$" + orderTotal.toFixed(2), 190, y, { align: "right" });

      const pdfBase64 = doc.output("datauristring").split("base64,")[1];
      const { data: { session } } = await supabase.auth.getSession();
      const { data: res, error: fErr } = await supabase.functions.invoke("send-purchase-order", {
        body: { to: po.suppliers.email, supplierName: po.suppliers.name, poNumber: po.po_number, pdfBase64, accessToken: session?.access_token || null },
      });
      if (fErr || res?.error) {
        let detail = res?.error || (fErr && fErr.message) || "Unknown error";
        try { if (fErr && fErr.context && fErr.context.json) { const b = await fErr.context.json(); if (b && b.error) detail = b.error; } } catch (_e) {}
        setError("Couldn't email the order: " + detail); setEmailing(false); return;
      }
      if (po.status === "Draft") await supabase.from("purchase_orders").update({ status: "Ordered" }).eq("id", id);
      setOk("Order emailed to " + (po.suppliers.name || "the supplier") + ".");
      setEmailing(false);
      load();
    } catch (e) {
      setError("Couldn't build the PDF: " + String(e)); setEmailing(false);
    }
  }

  async function receive() {
    setError(null); setOk(null);
    setSaving(true);
    const lines = items.map((it) => ({
      item_id: it.id,
      qty_received: Math.max(0, Math.round(Number(recv[it.id]?.qty) || 0)),
      unit_cost: Number(recv[it.id]?.cost) || 0,
    }));
    const { error } = await supabase.rpc("receive_purchase_order", { p_po_id: id, p_lines: lines, p_gst: gstAuto ? null : (Number(gst) || 0) });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setOk("Received and posted to your books.");
    load();
  }

  if (loading) return <main className="mx-auto max-w-2xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>;
  if (error && !po) return <main className="mx-auto max-w-2xl px-4 py-8"><p className="text-sm text-red-600" role="alert">{error}</p></main>;
  if (!po) return null;
  const canReceive = po.status === "Draft" || po.status === "Ordered";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/purchase-orders" className="text-sm text-zinc-500 hover:underline">← Purchase Orders</Link>
      <div className="mt-2 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{poNo(po.po_number)}</h1>
        <span className={"rounded-full px-2 py-0.5 text-xs font-semibold " + (STATUS_STYLES[po.status] || "bg-zinc-100 text-zinc-700")}>{po.status}</span>
      </div>
      <p className="mt-1 text-zinc-600">{po.suppliers?.name || "—"} · ordered {po.order_date}{po.received_date ? ` · received ${po.received_date}` : ""}</p>

      {ok && <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{ok}</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <span>Part</span><span className="text-right">Ordered</span><span className="text-right">{canReceive ? "Receiving" : "Received"}</span><span className="text-right">Cost ea</span>
        </div>
        {items.map((it) => (
          <div key={it.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 border-t border-zinc-100 px-4 py-2 text-sm">
            <span className="min-w-0 truncate text-zinc-800">{it.parts?.name || it.description}{it.job_cards && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">Job #{it.job_cards.job_number}</span>}</span>
            <span className="w-12 text-right text-zinc-500">{it.qty_ordered}</span>
            {canReceive ? (
              <input type="number" min="0" inputMode="numeric" value={recv[it.id]?.qty ?? ""} onChange={setR(it.id, "qty")} className="w-16 rounded border border-zinc-300 px-2 py-1 text-right" />
            ) : (
              <span className="w-16 text-right text-zinc-800">{it.qty_received}</span>
            )}
            {canReceive ? (
              <input type="number" min="0" step="0.01" inputMode="decimal" value={recv[it.id]?.cost ?? ""} onChange={setR(it.id, "cost")} className="w-20 rounded border border-zinc-300 px-2 py-1 text-right" />
            ) : (
              <span className="w-20 text-right text-zinc-800">{money(it.unit_cost)}</span>
            )}
          </div>
        ))}
      </div>

      {canReceive ? (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-600">
            <span>Goods: <strong className="text-zinc-900">{money(goods)}</strong></span>
            <label className="flex items-center gap-2">GST
              <input type="number" min="0" step="0.01" value={gstAuto ? gstVal : gst} onChange={(e) => { setGstAuto(false); setGst(e.target.value); }} className="w-20 rounded border border-zinc-300 px-2 py-1 text-right" />
              {!gstAuto && <button type="button" onClick={() => { setGstAuto(true); setGst(""); }} className="text-xs text-red-600 hover:underline">auto 15%</button>}
            </label>
            <span>Total: <strong className="text-zinc-900">{money(total)}</strong></span>
          </div>
          <p className="mt-2 text-xs text-zinc-500">Enter what actually arrived — quantities, costs and GST are all editable. Receiving adds stock and records this as an on-account bill (Cost of Parts + GST, owed to the supplier).</p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <button onClick={receive} disabled={saving || goods <= 0} className={btn + " disabled:opacity-50"}>{saving ? "Receiving…" : "Receive & post"}</button>
            <button onClick={emailPO} disabled={emailing} className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50">{emailing ? "Emailing…" : "email to supplier"}</button>
            {po.status === "Draft" && <button onClick={markOrdered} className="text-sm text-zinc-600 hover:underline">mark as ordered</button>}
            <button onClick={cancel} className="ml-auto text-sm text-red-500 hover:underline">cancel order</button>
          </div>
        </div>
      ) : po.status === "Received" ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Received and posted to the books.</p>
          {po.expenses && (
            <p className="mt-1">Recorded as {expNo(po.expenses.expense_number)} — {money(po.expenses.amount_ex_gst)} + {money(po.expenses.gst)} GST = {money(po.expenses.total)}, owed to {po.suppliers?.name || "the supplier"} (Accounts Payable). It flows into your <Link href="/reports" className="underline">Reports</Link>.</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">This order was cancelled.</p>
      )}
    </main>
  );
}
