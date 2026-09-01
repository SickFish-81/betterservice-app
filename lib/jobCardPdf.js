// jobCardPdf.js — the job card as a sheet of paper.
//
// This is a WORKING document, for Craig to read before he confirms a job — not
// something a customer receives. It shows what an invoice never does: what the
// job cost the shop, who clocked what, and the shop's own internal notes. The
// internal block is labelled as such, plainly, because the most likely accident
// with a document like this is emailing it to the customer.
//
// Same shape as invoicePdf.js and deliberately separate from it: an invoice is a
// legal record of a transaction, a job card is a snapshot of work in progress.
// Tying them to one template would mean a change meant for one silently altering
// the other.
//
// No React, no Supabase — plain data in, a jsPDF document out.

const PAGE_W = 210;
const LEFT = 20;
const RIGHT = 190;
const BOTTOM = 268;
const LOGO_W = 30;
const LOGO_RATIO = 730 / 900;

export const jobCardFileName = (job) => `Job-${String(job?.job_number ?? 0).padStart(4, "0")}.pdf`;

const money = (n) => "$" + Number(n || 0).toFixed(2);
const nz = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-NZ") : "—");

async function loadLogo() {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Draw the job card.
 *
 * @param {object}   a
 * @param {object}   a.settings  shop_settings row
 * @param {object}   a.job       job_cards row with .customers and .machines joined
 * @param {object[]} a.items     job_line_items for the job
 * @param {object[]} a.times     job_time_entries, with .staff joined
 * @param {object[]} a.checklist job_checklist_items
 * @returns {Promise<import("jspdf").jsPDF>}
 */
export async function buildJobCardPdf({ settings, job, items = [], times = [], checklist = [] }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const logo = await loadLogo();
  let y = 20;

  const newPage = () => { doc.addPage(); y = 20; };
  const room = (mm) => { if (y + mm > BOTTOM) newPage(); };

  const heading = (text) => {
    room(14);
    y += 4;
    doc.setFontSize(11); doc.setFont(undefined, "bold");
    doc.text(text, LEFT, y);
    doc.setFont(undefined, "normal"); doc.setFontSize(10);
    y += 2;
    doc.setDrawColor(200); doc.line(LEFT, y, RIGHT, y); doc.setDrawColor(0);
    y += 5;
  };

  const wrapped = (text, x = LEFT, width = RIGHT - LEFT) => {
    for (const ln of doc.splitTextToSize(String(text ?? ""), width)) {
      room(6);
      doc.text(ln, x, y);
      y += 5;
    }
  };

  // ---- Header ----
  if (logo) {
    try { doc.addImage(logo, "PNG", RIGHT - LOGO_W, 14, LOGO_W, LOGO_W * LOGO_RATIO); } catch { /* never block on a bad image */ }
  }
  doc.setFontSize(18); doc.setFont(undefined, "bold");
  doc.text("JOB CARD #" + String(job?.job_number ?? ""), LEFT, y);
  doc.setFont(undefined, "normal"); doc.setFontSize(10);
  y += 7;
  doc.setTextColor(90);
  doc.text(settings?.business_name || "Betterservice ATV", LEFT, y); y += 5;
  if (settings?.phone) { doc.text(settings.phone, LEFT, y); y += 5; }
  doc.setTextColor(0);
  y += 2;
  doc.text("Status: " + (job?.status || "—"), LEFT, y);
  doc.text("Job date: " + nz(job?.job_date || job?.created_at), LEFT + 60, y);
  y += 5;
  if (job?.promised_date) { doc.text("Promised: " + nz(job.promised_date), LEFT, y); y += 5; }

  // ---- Customer & machine ----
  heading("Customer");
  const c = job?.customers || {};
  if (c.company_name) { doc.setFont(undefined, "bold"); wrapped(c.company_name); doc.setFont(undefined, "normal"); wrapped("Attn: " + (c.name || "")); }
  else { doc.setFont(undefined, "bold"); wrapped(c.name || "—"); doc.setFont(undefined, "normal"); }
  if (c.phone) wrapped(c.phone);
  if (c.email) wrapped(c.email);
  if (c.address) wrapped(c.address);

  heading("Machine");
  const m = job?.machines || {};
  wrapped([m.type, m.make, m.model].filter(Boolean).join(" ") || "—");
  if (m.vin) wrapped("VIN: " + m.vin);
  if (m.key_number) wrapped("Key: " + m.key_number);

  // ---- What was asked for ----
  heading("Reported problem");
  wrapped(job?.reported_problem || "—");

  // ---- Checklist ----
  if (checklist.length) {
    heading("Checklist");
    for (const it of checklist) {
      room(6);
      doc.text((it.done ? "[x] " : "[ ] ") + String(it.label ?? it.description ?? ""), LEFT, y);
      y += 5;
    }
  }

  // ---- Time ----
  if (times.length) {
    heading("Time logged");
    let total = 0;
    for (const t of times) {
      const h = Number(t.hours || 0);
      total += h;
      room(6);
      doc.text(`${t.staff?.name || "—"} — ${h.toFixed(2)} h${t.billed ? " (billed)" : ""}${t.note ? " · " + t.note : ""}`, LEFT, y);
      y += 5;
    }
    room(6);
    doc.setFont(undefined, "bold");
    doc.text(`Total logged: ${total.toFixed(2)} h`, LEFT, y);
    doc.setFont(undefined, "normal");
    y += 5;
  }

  // ---- Labour & parts, with the shop's own cost alongside ----
  heading("Labour & parts");
  if (!items.length) {
    wrapped("Nothing added yet.");
  } else {
    room(6);
    doc.setFont(undefined, "bold");
    doc.text("Description", LEFT, y);
    doc.text("Qty", 120, y, { align: "right" });
    doc.text("Unit", 145, y, { align: "right" });
    doc.text("Cost", 167, y, { align: "right" });
    doc.text("Amount", RIGHT, y, { align: "right" });
    doc.setFont(undefined, "normal");
    y += 5;

    let sub = 0, cost = 0;
    for (const it of items) {
      const lines = doc.splitTextToSize(String(it.description ?? ""), 95);
      room(5 * lines.length + 2);
      lines.forEach((ln, i) => doc.text(ln, LEFT, y + i * 5));
      doc.text(String(it.quantity ?? ""), 120, y, { align: "right" });
      doc.text(money(it.unit_price), 145, y, { align: "right" });
      doc.text(it.cost_price != null ? money(it.cost_price) : "—", 167, y, { align: "right" });
      doc.text(money(it.amount), RIGHT, y, { align: "right" });
      sub += Number(it.amount || 0);
      cost += Number(it.cost_price || 0) * Number(it.quantity || 0);
      y += 5 * lines.length;
    }

    const gst = Math.round(sub * 0.15 * 100) / 100;
    room(24);
    y += 2; doc.setDrawColor(200); doc.line(120, y, RIGHT, y); doc.setDrawColor(0); y += 5;
    doc.text("Subtotal", 145, y); doc.text(money(sub), RIGHT, y, { align: "right" }); y += 5;
    doc.text("GST 15%", 145, y); doc.text(money(gst), RIGHT, y, { align: "right" }); y += 5;
    doc.setFont(undefined, "bold");
    doc.text("Total", 145, y); doc.text(money(sub + gst), RIGHT, y, { align: "right" });
    doc.setFont(undefined, "normal");
    y += 7;
    if (cost > 0) {
      doc.setTextColor(90);
      doc.setFontSize(9);
      doc.text(`Parts cost to shop ${money(cost)} · margin ${money(sub - cost)} before labour split`, LEFT, y);
      doc.setFontSize(10);
      doc.setTextColor(0);
      y += 5;
    }
  }

  // ---- Notes ----
  if (job?.customer_notes) {
    heading("Notes from the workshop (printed on the invoice)");
    wrapped(job.customer_notes);
  }
  if (job?.notes) {
    heading("Internal notes — NOT for the customer");
    wrapped(job.notes);
  }

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(
      `Job card #${job?.job_number ?? ""} · internal working document, not an invoice · printed ${new Date().toLocaleString("en-NZ")}`,
      PAGE_W / 2, 287, { align: "center" },
    );
    doc.text(`Page ${p} of ${pages}`, RIGHT, 287, { align: "right" });
    doc.setTextColor(0);
    doc.setFontSize(10);
  }

  return doc;
}
