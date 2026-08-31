"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { buildInvoicePdf, pdfToBase64, invoiceFileName } from "../../../lib/invoicePdf";
import { useOwner } from "../../RoleContext";

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
const invNo = (n) => String(n ?? 0).padStart(4, "0");
const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";

export default function JobDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const owner = useOwner();
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
  const [labourRate, setLabourRate] = useState("115");   // $/hr — editable, e.g. welding at 50
  const [partId, setPartId] = useState("");
  const [partQty, setPartQty] = useState("1");
  const [partPrice, setPartPrice] = useState("");   // blank = use the part's own price
  const [ordDesc, setOrdDesc] = useState("");
  const [ordQty, setOrdQty] = useState("1");
  const [ordCost, setOrdCost] = useState("");
  const [ordSupplier, setOrdSupplier] = useState("");
  const [ordRef, setOrdRef] = useState("");
  const [stopping, setStopping] = useState(null);   // entry awaiting a stop confirmation
  const [suppliers, setSuppliers] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [uploading, setUploading] = useState(false);

  // Pick-up dispatch — text the person set as "Picked up by".
  const [pickupAddr, setPickupAddr] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  const [pickupMsg, setPickupMsg] = useState(null);
  const [pickupSending, setPickupSending] = useState(false);
  useEffect(() => {
    if (job?.customers?.address) setPickupAddr((a) => a || job.customers.address);
  }, [job?.id]);

  // Friendly confirmation toast when staff save/update a job card.
  const [thanks, setThanks] = useState("");
  function sayThanks() {
    const msgs = ["Thanks — job card updated ✓", "Saved. Nice one!", "Cheers — that's logged ✓", "Updated. Ka pai!"];
    setThanks(msgs[Math.floor(Math.random() * msgs.length)]);
    setTimeout(() => setThanks(""), 2600);
  }

  const [timeEntries, setTimeEntries] = useState([]);
  const [timeStaffId, setTimeStaffId] = useState("");
  const [timeHours, setTimeHours] = useState("");
  const [timeNote, setTimeNote] = useState("");
  const [nowTs, setNowTs] = useState(Date.now());
  const [arrivedParts, setArrivedParts] = useState([]);

  const [editing, setEditing] = useState(false);
  const [eCustomer, setECustomer] = useState("");
  const [eMachine, setEMachine] = useState("");
  const [eProblem, setEProblem] = useState("");
  const [eNotes, setENotes] = useState("");
  const [eCustNotes, setECustNotes] = useState("");
  const [billHours, setBillHours] = useState("");
  const [billRate, setBillRate] = useState("115");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    // All 14 reads are independent, so fire them together instead of one-by-one.
    const [
      { data: j, error: jErr },
      { data: li },
      { data: s },
      { data: inv },
      { data: pr },
      { data: tpl },
      { data: cl },
      { data: ph },
      { data: te },
      { data: sup },
      { data: ap },
      { data: cust },
      { data: mach },
      { data: st },
    ] = await Promise.all([
      supabase.from("job_cards").select("*, customers(name, phone, email, address), machines(type, make, model, vin, key_number)").eq("id", id).single(),
      supabase.from("job_line_items").select("*, suppliers(name)").eq("job_card_id", id).order("created_at"),
      supabase.from("staff").select("id, name, can_send_invoices").order("name"),
      supabase.from("invoices").select("*").eq("job_card_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("parts").select("*").order("name"),
      supabase.from("checklist_templates").select("*").order("name"),
      supabase.from("job_checklist_items").select("*").eq("job_card_id", id).order("position"),
      supabase.from("job_photos").select("*").eq("job_card_id", id).order("created_at"),
      supabase.from("job_time_entries").select("*, staff(name)").eq("job_card_id", id).order("created_at"),
      supabase.from("suppliers").select("id, name").order("name"),
      supabase.from("purchase_order_items").select("*, parts(name, unit_price), purchase_orders!inner(po_number, status)").eq("job_card_id", id).is("accepted_at", null).eq("purchase_orders.status", "Received").gt("qty_received", 0),
      supabase.from("customers").select("id, name").order("name"),
      supabase.from("machines").select("id, customer_id, type, make, model"),
      supabase.from("shop_settings").select("*").eq("id", 1).single(),
    ]);
    if (jErr) setError(jErr.message);
    else setJob(j);
    setItems(li || []);
    setStaff(s || []);
    setInvoice(inv && inv.length ? inv[0] : null);
    setParts(pr || []);
    setTemplates(tpl || []);
    setChecklist(cl || []);
    setPhotos(ph || []);
    setTimeEntries(te || []);
    setSuppliers(sup || []);
    setArrivedParts(ap || []);
    setCustomers(cust || []);
    setMachines(mach || []);
    setSettings(st || null);
    setLoading(false);
  }

  useEffect(() => { if (id) load(); }, [id]);

  // Keep running timers ticking on screen (updates every 30s).
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const subtotal = round2(items.reduce((s, it) => s + Number(it.amount), 0));
  const totalHours = timeEntries.reduce((s, t) => s + Number(t.hours || 0), 0);
  const gst = round2(subtotal * 0.15);
  const total = round2(subtotal + gst);
  const senders = staff.filter((s) => s.can_send_invoices);
  const staffName = (sid) => staff.find((s) => s.id === sid)?.name;
  const eMachines = machines.filter((m) => m.customer_id === eCustomer);

  async function updateJobField(field, value) {
    await supabase.from("job_cards").update({ [field]: value }).eq("id", id);
    sayThanks(); load();
  }

  function startEdit() {
    setECustomer(job.customer_id || "");
    setEMachine(job.machine_id || "");
    setEProblem(job.reported_problem || "");
    setENotes(job.notes || "");
    setECustNotes(job.customer_notes || "");
    setEditing(true);
  }

  async function saveDetails() {
    await supabase.from("job_cards").update({
      customer_id: eCustomer || null, machine_id: eMachine || null,
      reported_problem: eProblem, notes: eNotes, customer_notes: eCustNotes,
    }).eq("id", id);
    setEditing(false); sayThanks(); load();
  }

  async function addLabour(e) {
    e.preventDefault();
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const rate = Number(labourRate);
    if (!Number.isFinite(rate) || rate < 0) { setError("Rate must be a number."); return; }
    const { error } = await supabase.from("job_line_items").insert({ job_card_id: id, kind: "labour", description: labourDesc || "Labour", quantity: Math.max(0, Number(hours) || 0), unit_price: Math.round(rate * 100) / 100 });
    if (error) { setError(error.message); return; }
    setLabourDesc(""); setHours("1"); setLabourRate(String(shopRate)); load();
  }

  // A part ordered in from a supplier for this job — not stock, so nothing is
  // drawn down. Craig enters what it cost; the database applies the shop's
  // markup and works out the charge, so the sum is done in one place.
  async function addOrderedPart(e) {
    e.preventDefault();
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const q = Number(ordQty);
    const c = Number(ordCost);
    if (!ordDesc.trim()) { setError("Name the part."); return; }
    if (!(q > 0)) { setError("Quantity must be more than zero."); return; }
    if (!Number.isFinite(c) || c < 0) { setError("Enter what the part cost you."); return; }
    const { error } = await supabase.rpc("add_ordered_part_to_job", {
      p_job_id: id, p_description: ordDesc.trim(), p_qty: q, p_cost: c,
      p_supplier_id: ordSupplier || null, p_supplier_ref: ordRef.trim() || null,
    });
    if (error) { setError(error.message); return; }
    setOrdDesc(""); setOrdQty("1"); setOrdCost(""); setOrdRef(""); setError(null); load();
  }

  // Add a part FROM inventory, drawing it down from stock.
  async function addPart(e) {
    e.preventDefault();
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const part = parts.find((p) => p.id === partId);
    if (!part) { setError("Pick a part from inventory."); return; }
    const q = Math.max(0.01, Number(partQty) || 1);
    // Blank price = bill the part's own price. A typed price applies to THIS job only
    // and never changes the inventory record.
    const priceEntered = partPrice.trim() !== "" && Number.isFinite(Number(partPrice));
    const p = priceEntered ? Math.max(0, Number(partPrice)) : null;
    if (partPrice.trim() !== "" && !priceEntered) { setError("Price must be a number."); return; }
    // Atomic in the DB: inserts the line item and draws stock down together (no read-then-write race).
    const { error } = await supabase.rpc("add_part_to_job", { p_job_id: id, p_part_id: part.id, p_qty: q, p_unit_price: p });
    if (error) { setError(error.message); return; }
    setPartId(""); setPartQty("1"); setPartPrice(""); load();
  }

  // Removing a stocked part puts it back on the shelf.
  async function removeItem(it) {
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    // Atomic in the DB: deletes the line item and restocks the part together.
    const { error } = await supabase.rpc("remove_job_line_item", { p_item_id: it.id });
    if (error) { setError("Couldn't remove item: " + error.message); return; }
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

  // ---- Time tracking (actual hours worked, for job costing) ----
  async function startTimer() {
    if (!timeStaffId) { setError("Pick who's working first."); return; }
    const running = timeEntries.find((t) => t.staff_id === timeStaffId && t.started_at && !t.ended_at);
    if (running) { setError("That person already has a timer running on this job."); return; }
    const { error } = await supabase.from("job_time_entries").insert({ job_card_id: id, staff_id: timeStaffId, started_at: new Date().toISOString() });
    if (error) { setError(error.message); return; }
    load();
  }

  // Stopping asks first. Rounding up means a timer knocked on by accident would
  // otherwise bill a quarter hour, so the labour only goes on once someone says
  // so. The figure shown is a preview; the database does the real sum.
  async function stopTimer(entry, bill) {
    setError(null);
    setStopping(null);
    const { error } = await supabase.rpc("stop_job_timer", { p_entry_id: entry.id, p_bill: bill });
    if (error) { setError(error.message); return; }
    load();
  }

  // Same rule as the database: up to the next quarter hour, minimum a quarter.
  function previewHours(entry) {
    const worked = Math.max(0, (nowTs - new Date(entry.started_at).getTime()) / 3600000);
    return Math.max(0.25, Math.ceil(worked * 4) / 4);
  }

  async function addManualTime(e) {
    e.preventDefault();
    if (!timeStaffId) { setError("Pick who did the work."); return; }
    const h = Number(timeHours);
    if (!(h > 0)) { setError("Enter hours greater than zero."); return; }
    const { error } = await supabase.from("job_time_entries").insert({ job_card_id: id, staff_id: timeStaffId, hours: h, note: timeNote || null });
    if (error) { setError(error.message); return; }
    setTimeHours(""); setTimeNote(""); load();
  }

  // Turn a logged time entry into a billable labour line, at the shop rate.
  async function billTime(entry) {
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    if (!entry.hours) { setError("Stop the timer first so it has hours."); return; }
    const who = entry.staff?.name || staffName(entry.staff_id) || "Labour";
    const { error } = await supabase.from("job_line_items").insert({ job_card_id: id, kind: "labour", description: entry.note || (who + " — labour"), quantity: entry.hours, unit_price: shopRate });
    if (error) { setError(error.message); return; }
    await supabase.from("job_time_entries").update({ billed: true }).eq("id", entry.id);
    load();
  }

  // Turn every unbilled entry into ONE labour line, at whatever hours the owner
  // decides is fair. Clocked time is what happened; billed time is a judgement —
  // so the hours are editable here rather than copied across blindly.
  async function billAllTime(charge) {
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    if (unbilledEntries.length === 0) return;
    if (charge) {
      const h = Number(billHours === "" ? unbilledHours : billHours);
      const r = Number(billRate);
      if (!(h > 0)) { setError("Hours must be more than zero."); return; }
      if (!Number.isFinite(r) || r < 0) { setError("Rate must be a number."); return; }
      if (!window.confirm(`Add ${h} h at $${r}/hr = $${(h * r).toFixed(2)} + GST as labour on this job?`)) return;
      const { error } = await supabase.from("job_line_items").insert({
        job_card_id: id, kind: "labour", description: "Labour", quantity: h, unit_price: Math.round(r * 100) / 100,
      });
      if (error) { setError(error.message); return; }
    } else if (!window.confirm(`Leave ${unbilledHours} h off the invoice? The time stays on the timesheet, but nothing is charged for it.`)) {
      return;
    }
    await supabase.from("job_time_entries").update({ billed: true }).in("id", unbilledEntries.map((t) => t.id));
    setBillHours("");
    load();
  }

  async function removeTime(entry) {
    await supabase.from("job_time_entries").delete().eq("id", entry.id);
    load();
  }

  // Accept a part that was ordered for this job and has now arrived (received on its PO).
  async function acceptPart(it) {
    if (invoice) { setError("This job has an invoice — labour & parts are locked."); return; }
    const { error } = await supabase.rpc("accept_po_item_to_job", { p_item_id: it.id });
    if (error) { setError(error.message); return; }
    load();
  }

  // Flag a part the job needs ordered — lands in Craig's Parts Requests queue.
  // Hand the job to Craig. Everyone can do this, owners included — Craig can
  // invoice straight from here, but if he's worked the job himself the button
  // shouldn't vanish on him.
  async function sendForApproval() {
    setError(null);
    const { error } = await supabase.rpc("mark_job_ready", { p_job_id: id });
    if (error) { setError(error.message); return; }
    load();
  }

  async function generateInvoice() {
    // Time logged but never billed is money given away — job 10 went out with
    // 2.38 h on it and no labour at all. Don't let that happen silently.
    if (unbilledHours > 0 && !window.confirm(
      `There's ${unbilledHours} h logged on this job that hasn't been charged as labour.\n\nInvoice anyway without charging it?`
    )) return;
    // Totals are computed on the server from the job's own line items (never
    // trusted from the browser); the function also flips the job to "Invoiced".
    const { error } = await supabase.rpc("generate_invoice", { p_job_id: id });
    if (error) { setError(error.message); return; }
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
    // One shared builder draws every invoice — see lib/invoicePdf.js. The view page
    // uses the same one, so what you re-print is exactly what the customer got.
    const doc = await buildInvoicePdf({ settings, invoice, job, items });
    doc.save(invoiceFileName(invoice));
    const pdfBase64 = pdfToBase64(doc);
    // Pass our login token in the body so the function can file the PDF as a signed-in staff member.
    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("send-invoice", {
      body: { to: job.customers?.email || null, customerName: job.customers?.name, invoiceNumber: invoice.invoice_number, total: invoice.total, pdfBase64, accessToken: session?.access_token || null },
    });
    if (fErr || res?.error) {
      let detail = res?.error || (fErr && fErr.message) || "Unknown error";
      try { if (fErr && fErr.context && fErr.context.json) { const b = await fErr.context.json(); if (b && b.error) detail = b.error; } } catch (_e) {}
      setError("Couldn't file the invoice: " + detail);
      return;
    }
    // Don't re-send client-side money — the invoice already holds the server-computed totals.
    await supabase.from("invoices").update({ sent: true, sent_by: senderId, sent_at: new Date().toISOString(), pdf_url: res.pdfPath }).eq("id", invoice.id);
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

  // Text the assigned pick-up person the address, time and notes.
  async function textPickup() {
    setError(null); setPickupMsg(null);
    const picker = staff.find((s) => s.id === job.picked_up_by);
    if (!picker) { setError("Set who's picking it up first (the “Picked up by” dropdown)."); return; }
    if (!picker.phone) { setError(`${picker.name} has no phone number — add one on the Staff page.`); return; }
    const machine = [job.machines?.type, job.machines?.make, job.machines?.model].filter(Boolean).join(" ");
    const message = [
      `Pick-up — job #${job.job_number}: ${job.customers?.name || ""}${machine ? " — " + machine : ""}`,
      pickupAddr ? `Address: ${pickupAddr}` : null,
      pickupTime ? `Time: ${pickupTime}` : null,
      pickupNotes ? `Notes: ${pickupNotes}` : null,
    ].filter(Boolean).join("\n");
    setPickupSending(true);
    const { data: { session } } = await supabase.auth.getSession();
    const { data: res, error: fErr } = await supabase.functions.invoke("send-sms", {
      body: { to: picker.phone, body: message, customerId: job.customer_id, accessToken: session?.access_token || null },
    });
    setPickupSending(false);
    if (fErr || res?.error) {
      let detail = res?.error || (fErr && fErr.message) || "Unknown error";
      try { if (fErr && fErr.context && fErr.context.json) { const b = await fErr.context.json(); if (b && b.error) detail = b.error; } } catch (_e) {}
      setError("Couldn't send the text: " + detail);
      return;
    }
    setPickupMsg(`Texted ${picker.name} at ${picker.phone}.`);
  }

  // Only blank the page on the FIRST load. Re-fetching after an edit keeps the
  // existing content mounted, so the browser holds your scroll position.
  if (loading && !job) return <main className="mx-auto max-w-2xl px-4 py-8"><p className="text-zinc-500">Loading…</p></main>;
  if (!job) return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/jobs" className="text-sm font-medium text-zinc-500 hover:text-zinc-800">← Job Cards</Link>
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

  // Entries that are finished, have hours, and haven't been charged yet.
  const unbilledEntries = timeEntries.filter((t) => !t.billed && !(t.started_at && !t.ended_at) && Number(t.hours) > 0);
  const unbilledHours = Math.round(unbilledEntries.reduce((sum, t) => sum + Number(t.hours || 0), 0) * 100) / 100;

  const shopRate = Number(settings?.labour_rate ?? 115);
  const readyByName = (staff || []).find((x) => x.id === job?.ready_by)?.name || "";
  const markupPct = Number(settings?.parts_markup_percent ?? 30);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/jobs" className="text-sm font-medium text-zinc-500 hover:text-zinc-800">← Job Cards</Link>

      {thanks && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-lg">{thanks}</div>
        </div>
      )}

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
            <textarea value={eNotes} onChange={(e) => setENotes(e.target.value)} rows={2} placeholder="Shop notes — internal, also texted with the pick-up message" className={input} />
            <textarea value={eCustNotes} onChange={(e) => setECustNotes(e.target.value)} rows={3} placeholder="Notes for the customer — prints on the invoice (e.g. brakes 1/2 worn, clutch adjusted to spec)" className={input} />
            <div className="flex gap-2">
              <button onClick={saveDetails} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700">Save</button>
              <button onClick={() => setEditing(false)} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 font-medium text-zinc-900">{job.customers?.name} <span className="font-normal text-zinc-500">· {job.customers?.phone}</span></p>
            <p className="text-sm text-zinc-600">{job.machines?.type} {job.machines?.make} {job.machines?.model}{job.machines?.vin ? " · VIN " + job.machines.vin : ""}{job.machines?.key_number ? " · Key " + job.machines.key_number : ""}</p>
            {job.customers?.address && <p className="mt-1 text-sm text-zinc-600"><span className="font-medium text-zinc-700">Address:</span> {job.customers.address}</p>}
            {job.reported_problem && <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">{job.reported_problem}</p>}
            {job.notes && <p className="mt-2 text-sm text-zinc-600"><span className="font-medium text-zinc-700">Notes:</span> {job.notes}</p>}
            {job.customer_notes && <p className="mt-2 text-sm text-zinc-600"><span className="font-medium text-zinc-700">For the customer:</span> {job.customer_notes}</p>}
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

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Pick-up dispatch</h2>
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-zinc-600">Texts the address, time and notes to whoever's set as <span className="font-medium text-zinc-800">Picked up by</span> above.</p>
        <div className="mt-3 flex flex-col gap-2">
          <input value={pickupAddr} onChange={(e) => setPickupAddr(e.target.value)} placeholder="Pick-up address" className={input} />
          <input value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} placeholder="Pick-up time (e.g. today, 3pm)" className={input} />
          <textarea value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} rows={2} placeholder="Notes (gate code, which shed, who to ask for…)" className={input} />
          <div className="flex items-center gap-3">
            <button onClick={textPickup} disabled={pickupSending} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{pickupSending ? "Sending…" : "Text pick-up details"}</button>
            {pickupMsg && <span className="text-sm text-green-600">{pickupMsg}</span>}
          </div>
        </div>
      </div>

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

      {!invoice && unbilledHours > 0 && (
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">{unbilledHours} h logged on this job hasn&apos;t been charged as labour.</p>
          <p className="mt-1 text-xs text-amber-800">Check the hours before they go on the invoice — adjust them if the clocked time isn&apos;t what you&apos;d charge.</p>
          {owner ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium text-amber-900">Hours
                <input value={billHours} onChange={(e) => setBillHours(e.target.value)} type="number" step="0.25" min="0" placeholder={String(unbilledHours)} className="mt-1 block w-24 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm text-zinc-900" />
              </label>
              <label className="text-xs font-medium text-amber-900">Rate $/h
                <input value={billRate || String(shopRate)} onChange={(e) => setBillRate(e.target.value)} type="number" step="1" min="0" className="mt-1 block w-24 rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-sm text-zinc-900" />
              </label>
              <button onClick={() => billAllTime(true)} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700">Bill as labour</button>
              <button onClick={() => billAllTime(false)} className="pb-2 text-xs text-amber-800 underline hover:text-amber-900">don&apos;t charge this time</button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-800">An owner needs to put this on the invoice.</p>
          )}
        </div>
      )}

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Time on this job</h2>
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        {timeEntries.length === 0 ? (
          <p className="text-sm text-zinc-500">No time logged yet. Start a timer or add hours below.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {timeEntries.map((t) => {
              const running = t.started_at && !t.ended_at;
              const elapsed = running ? (nowTs - new Date(t.started_at).getTime()) / 3600000 : 0;
              return (
                <li key={t.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium text-zinc-900">{t.staff?.name || "—"}</span>
                    {running ? (
                      <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">running · {elapsed.toFixed(2)} h</span>
                    ) : (
                      <span className="ml-2 text-zinc-600">{Number(t.hours || 0).toFixed(2)} h</span>
                    )}
                    {t.note && <span className="ml-2 text-zinc-500">— {t.note}</span>}
                    {t.billed && <span className="ml-2 text-xs font-medium text-emerald-600">billed</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {running && <button onClick={() => setStopping(stopping === t.id ? null : t.id)} className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700">Stop</button>}
                    {owner && !running && !t.billed && !invoice && <button onClick={() => billTime(t)} className="text-xs font-medium text-red-600 hover:underline">bill as labour</button>}
                    <button onClick={() => removeTime(t)} className="text-xs text-red-500 hover:underline">remove</button>
                  </span>
                  </div>

                  {stopping === t.id && running && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-amber-900">
                        Stop and charge <span className="font-semibold">{previewHours(t).toFixed(2)} h</span> at {money(shopRate)}/hr
                        {" = "}<span className="font-semibold">{money(previewHours(t) * shopRate)}</span> + GST?
                      </p>
                      <p className="mt-1 text-xs text-amber-800">Time is rounded up to the next 15 minutes.</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button onClick={() => stopTimer(t, true)} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">Yes, add it</button>
                        <button onClick={() => stopTimer(t, false)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">Stop, don&apos;t charge</button>
                        <button onClick={() => setStopping(null)} className="text-xs text-amber-700 hover:underline">keep running</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 border-t border-zinc-200 pt-2 text-sm font-medium text-zinc-700">Total logged: {totalHours.toFixed(2)} h</div>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[9rem] flex-1">
            <label className="block text-xs font-medium text-zinc-500">Who</label>
            <select value={timeStaffId} onChange={(e) => setTimeStaffId(e.target.value)} className={input}>
              <option value="">Select…</option>
              {staff.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </div>
          <button onClick={startTimer} type="button" className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700">Start timer</button>
        </div>

        <form onSubmit={addManualTime} className="mt-2 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
          <div className="w-24">
            <label className="block text-xs font-medium text-zinc-500">Or add hours</label>
            <input value={timeHours} onChange={(e) => setTimeHours(e.target.value)} type="number" min="0" step="0.25" placeholder="2.5" className={input} />
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className="block text-xs font-medium text-zinc-500">Note (optional)</label>
            <input value={timeNote} onChange={(e) => setTimeNote(e.target.value)} placeholder="e.g. diagnostics" className={input} />
          </div>
          <button className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">Add time</button>
        </form>
        {staff.length === 0 && <p className="mt-2 text-xs text-amber-600">Add people on the Staff page to log time.</p>}
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
                  <span className="ml-2 text-zinc-500">{owner ? `${it.quantity} × ${money(it.unit_price)}` : `×${it.quantity}`}</span>
                  {it.suppliers?.name && (
                    <span className="ml-2 text-xs text-zinc-400">from {it.suppliers.name}{it.supplier_ref ? ` · ${it.supplier_ref}` : ""}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {owner && <span className="font-semibold text-zinc-900">{money(it.amount)}</span>}
                  {!invoice && <button onClick={() => removeItem(it)} className="text-xs text-red-500 hover:underline">remove</button>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {owner && (
          <div className="border-t border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div className="flex justify-between text-zinc-600"><span>Subtotal</span><span>{money(subtotal)}</span></div>
            <div className="flex justify-between text-zinc-600"><span>GST 15%</span><span>{money(gst)}</span></div>
            <div className="mt-1 flex justify-between text-base font-bold text-zinc-900"><span>Total</span><span>{money(total)}</span></div>
          </div>
        )}
      </div>

      {invoice && <p className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-white p-3 text-xs text-zinc-500">Invoice #{invNo(invoice.invoice_number)} generated — labour &amp; parts are locked{invoice.sent || !owner ? "." : "; use Discard below to edit."}</p>}
      <form onSubmit={addLabour} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="min-w-[8rem] flex-1">
          <label className="block text-xs font-medium text-zinc-500">Labour</label>
          <input value={labourDesc} onChange={(e) => setLabourDesc(e.target.value)} placeholder="e.g. Full service" className={input} />
        </div>
        <div className="w-20">
          <label className="block text-xs font-medium text-zinc-500">Hours</label>
          <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" step="0.25" className={input} />
        </div>
        {owner && (
          <div className="w-24">
            <label className="block text-xs font-medium text-zinc-500">Rate $/hr</label>
            <input
              value={labourRate}
              onChange={(e) => setLabourRate(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              title="The shop rate comes from Settings. Change it here for work charged differently — welding, sublet, a quoted rate."
              className={input}
            />
          </div>
        )}
        <button disabled={!!invoice} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">Add labour</button>
      </form>

      {!invoice && (
        <form onSubmit={addOrderedPart} className="mt-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Part ordered in for this job</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1 text-xs font-medium text-zinc-600">Part
              <input value={ordDesc} onChange={(e) => setOrdDesc(e.target.value)} placeholder="e.g. Front brake pads, Honda" className={input} />
            </label>
            <label className="w-20 text-xs font-medium text-zinc-600">Qty
              <input value={ordQty} onChange={(e) => setOrdQty(e.target.value)} type="number" min="0" step="0.01" className={input} />
            </label>
            <label className="w-28 text-xs font-medium text-zinc-600">Cost each
              <input value={ordCost} onChange={(e) => setOrdCost(e.target.value)} type="number" min="0" step="0.01" placeholder="what you paid" className={input} />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-zinc-600">Supplier
              <select value={ordSupplier} onChange={(e) => setOrdSupplier(e.target.value)} className={input}>
                <option value="">Not recorded</option>
                {suppliers.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
            </label>
            <label className="w-40 text-xs font-medium text-zinc-600">Their invoice / docket
              <input value={ordRef} onChange={(e) => setOrdRef(e.target.value)} placeholder="optional" className={input} />
            </label>
            <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">Add part</button>
          </div>
          {Number(ordCost) > 0 && Number(ordQty) > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              Charged at ${(Math.round(Number(ordCost) * (1 + markupPct / 100) * 100) / 100).toFixed(2)} each
              {Number(ordQty) !== 1 && <> · {ordQty} × = ${(Math.round(Number(ordCost) * (1 + markupPct / 100) * 100) / 100 * Number(ordQty)).toFixed(2)}</>}
              {" "}(cost +{markupPct}%), before GST
            </p>
          )}
        </form>
      )}

      <form onSubmit={addPart} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="min-w-[10rem] flex-1">
          <label className="block text-xs font-medium text-zinc-500">Part (from inventory)</label>
          <select
            value={partId}
            onChange={(e) => {
              setPartId(e.target.value);
              const sel = parts.find((p) => p.id === e.target.value);
              setPartPrice(sel ? String(sel.unit_price ?? "") : "");
            }}
            className={input}
          >
            <option value="">Select a part…</option>
            {parts.map((p) => (<option key={p.id} value={p.id}>{p.name}{owner ? ` — ${money(p.unit_price)}` : ""} ({p.qty_on_hand} in stock)</option>))}
          </select>
        </div>
        <div className="w-16">
          <label className="block text-xs font-medium text-zinc-500">Qty</label>
          <input value={partQty} onChange={(e) => setPartQty(e.target.value)} type="number" min="0" step="0.01" className={input} />
        </div>
        {owner && (
          <div className="w-24">
            <label className="block text-xs font-medium text-zinc-500">Price each</label>
            <input
              value={partPrice}
              onChange={(e) => setPartPrice(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              title="Bills this job at this price. The part's price in inventory is unchanged."
              className={input}
            />
          </div>
        )}
        <button className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50" disabled={parts.length === 0 || !!invoice}>Add part</button>
        {parts.length === 0 && <p className="w-full text-xs text-amber-600">No parts in inventory yet — add some on the Parts page.</p>}
      </form>

      {arrivedParts.length > 0 && (
        <>
          <h2 className="mt-6 text-lg font-semibold text-zinc-900">Parts arrived from orders</h2>
          <div className="mt-2 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
            <ul className="divide-y divide-amber-100">
              {arrivedParts.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-zinc-900">{it.parts?.name || it.description}</span>
                    <span className="ml-2 text-zinc-500">{it.qty_received}{owner ? ` × ${money(it.parts?.unit_price ?? 0)}` : ""} · PO-{String(it.purchase_orders?.po_number ?? 0).padStart(4, "0")}</span>
                  </span>
                  <button onClick={() => acceptPart(it)} disabled={!!invoice} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Accept</button>
                </li>
              ))}
            </ul>
            <p className="border-t border-amber-100 px-3 py-2 text-xs text-amber-700">Ordered for this job and now in stock. Accept to add it to the job at the sell price — it comes off the shelf.</p>
          </div>
        </>
      )}

      <h2 className="mt-6 text-lg font-semibold text-zinc-900">Photos</h2>
      <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        {photos.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="group relative">
                <img src={p.url} alt="job photo" className="h-24 w-full rounded-lg object-cover" />
                <button onClick={() => removePhoto(p)} aria-label="Remove photo" className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100">×</button>
              </div>
            ))}
          </div>
        )}
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          {uploading ? "Uploading…" : "Add photo"}
          <input type="file" accept="image/*" capture="environment" onChange={uploadPhoto} className="hidden" disabled={uploading} />
        </label>
      </div>

      {job.status !== "Invoiced" && job.status !== "Paid" && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          {job.status === "Ready" ? (
            <p className="text-sm text-zinc-600">
              <span className="font-medium text-violet-700">Sent to Craig for approval</span>
              {job.ready_at ? ` · ${new Date(job.ready_at).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })}` : ""}
              {readyByName ? ` · by ${readyByName}` : ""}
            </p>
          ) : (
            <>
              <button onClick={sendForApproval} className="w-full rounded-lg bg-violet-600 px-4 py-2.5 font-medium text-white hover:bg-violet-700">
                Send to Craig for approval
              </button>
              <p className="mt-2 text-xs text-zinc-500">Marks the job Ready and puts it in front of Craig so it can be invoiced.</p>
            </>
          )}
        </div>
      )}

      {owner && (<>
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
      </>)}

      {error && <p className="mt-3 text-sm text-red-600">Error: {error}</p>}

      {owner && <button onClick={deleteJob} className="mt-6 text-sm text-red-500 hover:underline">Delete this job card</button>}
    </main>
  );
}
