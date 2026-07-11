"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

const STATUSES = ["New", "In progress", "Awaiting parts", "Ready", "Invoiced", "Paid"];
const STATUS_STYLES = {
  "New": "bg-blue-50 text-blue-700",
  "In progress": "bg-amber-50 text-amber-700",
  "Awaiting parts": "bg-orange-50 text-orange-700",
  "Ready": "bg-violet-50 text-violet-700",
  "Invoiced": "bg-zinc-100 text-zinc-700",
  "Paid": "bg-emerald-50 text-emerald-700",
};
const money = (n) => "$" + Number(n || 0).toFixed(2);
const invNo = (n) => String(n ?? 0).padStart(5, "0");
const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [items, setItems] = useState([]);
  const [staff, setStaff] = useState([]);
  const [invoice, setInvoice] = useState(null);
  const [parts, setParts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [checklist, setChecklist] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [machines, setMachines] = useState([]);
  const [settings, setSettings] = useState(null);

  const [senderId, setSenderId] = useState("");
  const [labourDesc, setLabourDesc] = useState("");
  const [hours, setHours] = useState("1");
  const [partId, setPartId] = useState("");
  const [partQty, setPartQty] = useState("1");
  const [newTask, setNewTask] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [uploading, setUploading] = useState(false);

  const [editing, setEditing] = useState(false);
  const [eCustomer, setECustomer] = useState("");
  const [eMachine, setEMachine] = useState("");
  const [eProblem, setEProblem] = useState("");
  const [eNotes, setENotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data: j, error: jErr } = await supabase
      .from("job_cards")
      .select("*, customers(name, phone, email, address), machines(type, make, model, rego)")
      .eq("id", id).single();
    const { data: li } = await supabase.from("job_line_items").select("*").eq("job_card_id", id).order("created_at");
    const { data: s } = await supabase.from("staff").select("id, name, can_send_invoices").order("name");
    const { data: inv } = await supabase.from("invoices").select("*").eq("job_card_id", id).order("created_at", { ascending: false }).limit(1);
    const { data: pr } = await supabase.from("parts").select("*").order("name");
    const { data: tpl } = await supabase.from("checklist_templates").select("*").order("name");
    const { data: cl } = await supabase.from("job_checklist_items").select("*").eq("job_card_id", id).order("position");
    const { data: ph } = await supabase.from("job_photos").select("*").eq("job_card_id", id).order("created_at");
    const { data: cust } = await supabase.from("customers").select("id, name").order("name");
    const { data: mach } = await supabase.from("machines").select("id, customer_id, type, make, model");
    const { data: st } = await supabase.from("shop_settings").select("*").eq("id", 1).single();
    if (jErr) setError(jErr.message);
    else setJob(j);
    setItems(li || []);
    setStaff(s || []);
    setInvoice(inv && inv.length ? inv[0] : null);
    setParts(pr || []);
    setTemplates(tpl || []);
    setChecklist(cl || []);
    setPhotos(ph || []);
    setCustomers(cust || []);
    setMachines(mach || []);
    setSettings(st || null);
    setLoading(false);
  }

  useEffect(() => { if (id) load(); }, [id]);

  const subtotal = items.reduce((s, it) => s + Number(it.amount), 0);
  const gst = subtotal * 0.15;
  const total = subtotal + gst;
  const senders = staff.filter((s) => s.can_send_invoices);
  const staffName = (sid) => staff.find((s) => s.id === sid)?.name;
  const eMachines = machines.filter((m) => m.customer_id === eCustomer);

  async function updateJobField(field, value) {
    await supabase.from("job_cards").update({ [field]: value }).eq("id", id);
    load();
  }

  function startEdit() {
    setECustomer(job.customer_id || "");
    setEMachine(job.machine_id || "");
    setEProblem(job.reported_problem || "");
    setENotes(job.notes || "");
    setEditing(true);
  }

  async function saveDetails() {
    await supabase.from("job_cards").update({
      customer_id: eCustomer || null, machine_id: eMachine || null,
      reported_problem: eProblem, notes: eNotes,
    }).eq("id", id);
    setEditing(false); load();
  }

  async function addLabour(e) {
    e.preventDefault();
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const { error } = await supabase.from("job_line_items").insert({ job_card_id: id, kind: "labour", description: labourDesc || "Labour", quantity: Math.max(0, Number(hours) || 0), unit_price: 115 });
    if (error) { setError(error.message); return; }
    setLabourDesc(""); setHours("1"); load();
  }

  // Add a part FROM inventory, drawing it down from stock.
  async function addPart(e) {
    e.preventDefault();
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const part = parts.find((p) => p.id === partId);
    if (!part) { setError("Pick a part from inventory."); return; }
    const q = Math.max(1, Number(partQty) || 1);
    const { error } = await supabase.from("job_line_items").insert({ job_card_id: id, kind: "part", part_id: part.id, description: part.name, quantity: q, unit_price: part.unit_price });
    if (error) { setError(error.message); return; }
    await supabase.from("parts").update({ qty_on_hand: Number(part.qty_on_hand) - q }).eq("id", part.id);
    setPartId(""); setPartQty("1"); load();
  }

  // Removing a stocked part puts it back on the shelf.
  async function removeItem(it) {
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const { error } = await supabase.from("job_line_items").delete().eq("id", it.id);
    if (error) { setError("Couldn't remove item: " + error.message); return; }
    if (it.kind === "part" && it.part_id) {
      const part = parts.find((p) => p.id === it.part_id);
      if (part) await supabase.from("parts").update({ qty_on_hand: Number(part.qty_on_hand) + Number(it.quantity) }).eq("id", it.part_id);
    }
    load();
  }

  async function applyTemplate() {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    const rows = (tpl.items || []).map((label, i) => ({ job_card_id: id, label, position: checklist.length + i }));
    if (rows.length) await supabase.from("job_checklist_items").insert(rows);
    setTemplateId(""); load();
  }

  async function addTask(e) {
    e.preventDefault();
    if (!newTask.trim()) return;
    await supabase.from("job_checklist_items").insert({ job_card_id: id, label: newTask, position: checklist.length });
    setNewTask(""); load();
  }

  async function toggleTask(item) {
    await supabase.from("job_checklist_items").update({ done: !item.done }).eq("id", item.id);
    load();
  }

  async function removeTask(itemId) {
    await supabase.from("job_checklist_items").delete().eq("id", itemId);
    load();
  }

  async function uploadPhoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true); setError(null);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = id + "/" + Date.now() + "-" + safe;
    const { error: upErr } = await supabase.storage.from("job-photos").upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) { setError("Photo upload failed: " + upErr.message); setUploading(false); return; }
    const { data: pub } = supabase.storage.from("job-photos").getPublicUrl(path);
    await supabase.from("job_photos").insert({ job_card_id: id, url: pub.publicUrl, path });
    setUploading(false); e.target.value = ""; load();
  }

  async function removePhoto(photo) {
    if (photo.path) await supabase.storage.from("job-photos").remove([photo.path]);
    await supabase.from("job_photos").delete().eq("id", photo.id);
    load();
  }

  async function generateInvoice() {
    const { error } = await supabase.from("invoices").insert({ job_card_id: id, subtotal, gst, total, status: "Unpaid" });
    if (error) { setError(error.message); return; }
    await supabase.from("job_cards").update({ status: "Invoiced" }).eq("id", id);
    load();
  }

  async function discardInvoice() {
    if (!invoice || invoice.sent) return;
    if (!window.confirm("Discard this draft invoice so you can edit labour & parts again?")) return;
    await supabase.from("invoices").delete().eq("id", invoice.id);
    if (job.status === "Invoiced") await supabase.from("job_cards").update({ status: "In progress" }).eq("id", id);
    load();
  }

  async function openPdf(p) {
    setError(null);
    if (!p) return;
    if (p.startsWith("http")) { window.open(p, "_blank"); return; }
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(p, 60);
    if (error) { setError("Couldn\u2019t open PDF: " + error.message); return; }
    window.open(data.signedUrl, "_blank");
  }

  async function approveAndSend() {
    if (!senderId) { setError("Choose who's sending — must be an owner who can send invoices."); return; }
    setError(null);
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18); doc.text(settings?.business_name || "Betterservice Tepuke", 20, y); y += 7;
    doc.setFontSize(10);
    if (settings?.address) { doc.text(settings.address, 20, y); y += 5; }
    if (settings?.phone) { doc.text("Ph: " + settings.phone, 20, y); y += 5; }
    doc.text(["GST #: " + (settings?.gst_number || "-"), settings?.bank_account ? "Bank: " + settings.bank_account : ""].filter(Boolean).join("    "), 20, y); y += 12;
    doc.setFontSize(14); doc.text("TAX INVOICE  #" + invNo(invoice.invoice_number), 20, y); y += 8;
    doc.setFontSize(10);
    doc.text("Date: " + new Date().toLocaleDateString("en-NZ"), 20, y); y += 6;
    doc.text("Customer: " + (job.customers?.name || ""), 20, y); y += 5;
    doc.text("Machine: " + [job.machines?.type, job.machines?.make, job.machines?.model].filter(Boolean).join(" "), 20, y); y += 10;
    doc.line(20, y, 190, y); y += 6;
    items.forEach((it) => {
      const desc = (it.kind === "labour" ? "Labour: " : "") + (it.description || "") + "  (" + it.quantity + " x $" + Number(it.unit_price).toFixed(2) + ")";
      doc.text(desc.substring(0, 70), 20, y);
      doc.text("$" + Number(it.amount).toFixed(2), 190, y, { align: "right" });
      y += 6;
    });
    y += 2; doc.line(120, y, 190, y); y += 6;
    doc.text("Subtotal", 120, y); doc.text("$" + subtotal.toFixed(2), 190, y, { align: "right" }); y += 5;
    doc.text("GST 15%", 120, y); doc.text("$" + gst.toFixed(2), 190, y, { align: "right" }); y += 6;
    doc.setFontSize(12); doc.text("Total", 120, y); doc.text("$" + total.toFixed(2), 190, y, { align: "right" });

    doc.save("Invoice-" + invNo(invoice.invoice_number) + ".pdf");
    const pdfBase64 = doc.output("datauristring").split("base64,")[1];
    // Pass our login token in the body so the function can file the PDF as a signed-in staff member.
    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("send-invoice", {
      body: { to: job.customers?.email || null, customerName: job.customers?.name, invoiceNumber: invoice.invoice_number, total, pdfBase64, accessToken: session?.access_token || null },
    });
    if (fErr || res?.error) {
      let detail = res?.error || (fErr && fErr.message) || "Unknown error";
      try { if (fErr && fErr.context && fErr.context.json) { const b = await fErr.context.json(); if (b && b.error) detail = b.error; } } catch (_e) {}
      setError("Couldn't file the invoice: " + detail);
      return;
    }
    await supabase.from("invoices").update({ sent: true, sent_by: senderId, sent_at: new Date().toISOString(), pdf_url: res.pdfPath, subtotal, gst, total }).eq("id", invoice.id);
    if (job.machine_id) {
      const todayNZ = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
      await supabase.from("machines").update({ last_service_date: todayNZ }).eq("id", job.machine_id);
    }
    if (res.emailError) setError("Invoice filed & marked sent, but the email to the customer didn't go: " + res.emailError);
    load();
  }

  async function deleteJob() {
    if (!window.confirm("Delete this job card? This can't be undone.")) return;
    await supabase.from("invoices").delete().eq("job_card_id", id);
    await supabase.from("job_cards").delete().eq("id", id);
    router.push("/jobs");
  }

  if (loading) return <main className="mx-auto max-w-2xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>;
  if (!job) return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/jobs" className="text-sm font-medium text-zinc-500 hover:text-zinc-800">← Job cards</Link>
      <p className="mt-4 text-red-600">Job not found.</p>
    </main>
  );

  const StaffPicker = ({ label, field }) => (
    <label className="flex flex-col text-sm">
      <span className="font-medium text-zinc-600">{label}</span>
      <select value={job[field] || ""} onChange={(e) => updateJobField(field, e.target.value || null)} className="mt-1 rounded-lg border border-zinc-300 px-2 py-2 text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100">
        <option value="">—</option>
        {staff.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
      </select>
    </label>
  );

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/jobs" className="text-sm font-medium text-zinc-500 hover:text-zinc-800">← Job cards</Link>

      <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Job #{job.job_number}</h1>
          <select value={job.status} onChange={(e) => updateJobField("status", e.target.value)} className={`rounded-full border-0 px-3 py-1.5 text-sm font-medium ${STATUS_STYLES[job.status] || "bg-zinc-100 text-zinc-700"}`}>
            {STATUSES.map((s) => (<option key={s}>{s}</option>))}
          </select>
        </div>

        {editing ? (
          <div className="mt-3 flex flex-col gap-2">
            <select value={eCustomer} onChange={(e) => { setECustomer(e.target.value); setEMachine(""); }} className={input}>
              <option value="">Select customer…</option>
              {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </select>
            <select value={eMachine} onChange={(e) => setEMachine(e.target.value)} className={input} disabled={!eCustomer}>
              <option value="">{eCustomer ? "Select machine…" : "Pick a customer first"}</option>
              {eMachines.map((m) => (<option key={m.id} value={m.id}>{m.type} — {m.make} {m.model}</option>))}
            </select>
            <textarea value={eProblem} onChange={(e) => setEProblem(e.target.value)} rows={2} placeholder="Reported problem / what needs doing" className={input} />
            <textarea value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={2} placeholder="Notes / inspection findings" className={input} />
            <div className="flex gap-2">
              <button onClick={saveDetails} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700">Save</button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 font-medium text-zinc-900">{job.customers?.name} <span className="font-normal text-zinc-500">· {job.customers?.phone}</span></p>
            <p className="text-sm text-zinc-600">{job.machines?.type} {job.machines?.make} {job.machines?.model} {job.machines?.rego}</p>
            {job.customers?.address && <p className="mt-1 text-sm text-zinc-600"><span className="font-medium text-zinc-700">Address:</span> {job.customers.address}</p>}
            {job.reported_problem && <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">{job.reported_problem}</p>}
            {job.notes && <p className="mt-2 text-sm text-zinc-600"><span className="font-medium text-zinc-700">Notes:</span> {job.notes}</p>}
            <button onClick={startEdit} className="mt-3 text-sm font-medium text-red-600 hover:text-red-700">Edit details</button>
          </>
        )}
      </div>

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Who handled it</h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StaffPicker label="Picked up by" field="picked_up_by" />
        <StaffPicker label="Serviced by" field="serviced_by" />
        <StaffPicker label="Dropped off by" field="dropped_off_by" />
      </div>
      {staff.length === 0 && <p className="mt-2 text-sm text-amber-600">Add people on the Staff page to fill these in.</p>}

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Checklist</h2>
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="flex-1 rounded-lg border border-zinc-300 px-2 py-2 text-sm">
            <option value="">Apply a template…</option>
            {templates.map((t) => (<option key={t.id} value={t.id}>{t.name} ({(t.items || []).length})</option>))}
          </select>
          <button onClick={applyTemplate} disabled={!templateId} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">Apply</button>
        </div>
        {checklist.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {checklist.map((it) => (
              <li key={it.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={it.done} onChange={() => toggleTask(it)} className="h-4 w-4 rounded border-zinc-300 accent-red-600" />
                <span className={it.done ? "flex-1 text-zinc-500 line-through" : "flex-1 text-zinc-800"}>{it.label}</span>
                <button onClick={() => removeTask(it.id)} className="text-xs text-red-500 hover:underline">remove</button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addTask} className="mt-3 flex gap-2">
          <input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task…" className={input} />
          <button className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Add</button>
        </form>
      </div>

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Labour &amp; parts</h2>
      <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">Nothing added yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="text-zinc-800">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium uppercase text-zinc-500">{it.kind}</span>
                  <span className="ml-2 font-medium text-zinc-900">{it.description}</span>
                  <span className="ml-2 text-zinc-500">{it.quantity} × {money(it.unit_price)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold text-zinc-900">{money(it.amount)}</span>
                  {!invoice && <button onClick={() => removeItem(it)} className="text-xs text-red-500 hover:underline">remove</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div className="flex justify-between text-zinc-600"><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div className="flex justify-between text-zinc-600"><span>GST 15%</span><span>{money(gst)}</span></div>
          <div className="mt-1 flex justify-between text-base font-bold text-zinc-900"><span>Total</span><span>{money(total)}</span></div>
        </div>
      </div>

      {invoice && <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-white p-3 text-xs text-zinc-500">Invoice #{invNo(invoice.invoice_number)} generated — labour &amp; parts are locked{invoice.sent ? "." : "; use Discard below to edit."}</p>}
      <form onSubmit={addLabour} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="min-w-[8rem] flex-1">
          <label className="block text-xs font-medium text-zinc-500">Labour</label>
          <input value={labourDesc} onChange={(e) => setLabourDesc(e.target.value)} placeholder="e.g. Full service" className={input} />
        </div>
        <div className="w-20">
          <label className="block text-xs font-medium text-zinc-500">Hours</label>
          <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" step="0.25" className={input} />
        </div>
        <div className="pb-2 text-xs text-zinc-500">@ $115/hr</div>
        <button disabled={!!invoice} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">Add labour</button>
      </form>

      <form onSubmit={addPart} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="min-w-[10rem] flex-1">
          <label className="block text-xs font-medium text-zinc-500">Part (from inventory)</label>
          <select value={partId} onChange={(e) => setPartId(e.target.value)} className={input}>
            <option value="">Select a part…</option>
            {parts.map((p) => (<option key={p.id} value={p.id}>{p.name} — {money(p.unit_price)} ({p.qty_on_hand} in stock)</option>))}
          </select>
        </div>
        <div className="w-16">
          <label className="block text-xs font-medium text-zinc-500">Qty</label>
          <input value={partQty} onChange={(e) => setPartQty(e.target.value)} type="number" min="1" className={input} />
        </div>
        <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" disabled={parts.length === 0 || !!invoice}>Add part</button>
        {parts.length === 0 && <p className="w-full text-xs text-amber-600">No parts in inventory yet — add some on the Parts page.</p>}
      </form>

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Photos</h2>
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        {photos.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="group relative">
                <img src={p.url} alt="job photo" className="h-24 w-full rounded-lg object-cover" />
                <button onClick={() => removePhoto(p)} className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100">×</button>
              </div>
            ))}
          </div>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          {uploading ? "Uploading…" : "Add photo"}
          <input type="file" accept="image/*" capture="environment" onChange={uploadPhoto} className="hidden" disabled={uploading} />
        </label>
      </div>

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Invoice</h2>
      {!invoice ? (
        <button onClick={generateInvoice} className="mt-2 w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700">
          Generate invoice ({money(total)})
        </button>
      ) : invoice.sent ? (
        <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-800">Invoice #{invNo(invoice.invoice_number)} sent ✓</p>
          <p className="mt-0.5 text-emerald-700">By {staffName(invoice.sent_by) || "—"} on {new Date(invoice.sent_at).toLocaleDateString("en-NZ")} · Total {money(invoice.total)}</p>
          {invoice.pdf_url && <button onClick={() => openPdf(invoice.pdf_url)} className="mt-1 inline-block font-medium text-emerald-700 underline">View filed PDF →</button>}
        </div>
      ) : (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">Invoice #{invNo(invoice.invoice_number)} — draft, awaiting owner approval</p>
          <p className="mt-0.5 text-amber-800">Total {money(invoice.total)}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col">
              <span className="text-xs font-medium text-amber-800">Sending as (owner only)</span>
              <select value={senderId} onChange={(e) => setSenderId(e.target.value)} className="mt-1 rounded-lg border border-amber-300 bg-white px-2 py-2 text-zinc-900">
                <option value="">Select…</option>
                {senders.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
            </label>
            <button onClick={approveAndSend} disabled={!senderId} className="rounded-lg bg-amber-600 px-3 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50">Approve &amp; send</button>
            <button onClick={discardInvoice} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium text-amber-800 hover:bg-amber-100">Discard</button>
          </div>
          {senders.length === 0 && <p className="mt-2 text-xs text-amber-800">No one can send yet — mark Craig as “can send invoices” on the Staff page.</p>}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">Error: {error}</p>}

      <button onClick={deleteJob} className="mt-6 text-sm text-red-500 hover:underline">Delete this job card</button>
    </main>
  );
}
