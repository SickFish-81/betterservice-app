// invoicePdf.js — the single source of truth for what a Betterservice invoice looks like.
//
// Both the job card (which sends the invoice) and the invoice view page (which
// re-prints and re-sends it) call this. That matters: if each drew its own PDF,
// what a customer received and what you see on screen could silently drift apart,
// and you'd have no way to know which was right.
//
// Deliberately has NO React and NO Supabase imports — it takes plain data and
// hands back a jsPDF document, so it can be called from anywhere and reasoned
// about on its own.

import { termsLabel } from "./paymentTerms";

export const invNo = (n) => String(n ?? 0).padStart(4, "0");
export const invoiceFileName = (invoice) => `Invoice-${invNo(invoice?.invoice_number)}.pdf`;

// A4 in jsPDF's default millimetres.
const PAGE_W = 210;
const PAGE_H = 297;
const LEFT = 20;
const RIGHT = 190;
const BOTTOM = 248;          // start a new page below this — leaves room for the footer block
const LOGO_W = 34;           // mm — logo.png is 900x730, so ~28mm tall
const LOGO_RATIO = 730 / 900;

// Shop strapline, printed at the foot of every page.
const TAGLINE = "Betterservice = Better Price = Better Advice = Better Bikes";

// Terms of trade, printed at the foot of every page. Two clauses that only work if
// they were on the invoice at the time: retention of title (the parts stay yours
// until they're paid for) and recovery of collection costs. Kept in code rather
// than Settings so git history records exactly what wording was in force when —
// which is the thing you'd need if a customer ever disputed it.
const DISCLAIMER =
  "Please Note: All parts remain the property of Betterservice ATV until paid in full, and are " +
  "subject to our terms and conditions of trade. All invoices unpaid by the due date will incur " +
  "collection costs.";

/** Load /logo.png as a data URL. Returns null if it can't be fetched — an invoice
 *  must still print without its logo rather than fail outright. */
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
 * Draw the invoice.
 *
 * @param {object}   a
 * @param {object}   a.settings  shop_settings row — business name, address, GST #, bank
 * @param {object}   a.invoice   the invoice row (number, issued_date, subtotal, gst, total)
 * @param {object}   a.job       the job card, with .customers and .machines joined
 * @param {object[]} a.items     job_line_items for that job
 * @returns {Promise<import("jspdf").jsPDF>}
 */
export async function buildInvoicePdf({ settings, invoice, job, items }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const logo = await loadLogo();
  let y = 20;

  // ---- Logo, top right ----
  if (logo) {
    try {
      doc.addImage(logo, "PNG", RIGHT - LOGO_W, 14, LOGO_W, LOGO_W * LOGO_RATIO);
    } catch {
      /* a bad image must never stop an invoice printing */
    }
  }

  // ---- Shop header (left, so it never collides with the logo) ----
  doc.setFontSize(18);
  doc.text(settings?.business_name || "Betterservice ATV", LEFT, y);
  y += 7;

  doc.setFontSize(10);
  if (settings?.address) { doc.text(settings.address, LEFT, y); y += 5; }
  if (settings?.phone)   { doc.text("Ph: " + settings.phone, LEFT, y); y += 5; }
  doc.text(
    [
      "GST #: " + (settings?.gst_number || "-"),
      settings?.bank_account ? "Bank: " + settings.bank_account : "",
    ].filter(Boolean).join("    "),
    LEFT, y,
  );

  // Clear the logo before the next block, however short the address was.
  y = Math.max(y + 12, 14 + LOGO_W * LOGO_RATIO + 8);

  // ---- Invoice header ----
  doc.setFontSize(14);
  doc.text("TAX INVOICE  #" + invNo(invoice?.invoice_number), LEFT, y);
  y += 8;

  doc.setFontSize(10);
  // The invoice's OWN issue date, not today. Reprinting an old invoice must show
  // the date it was actually issued, or the copy on file stops matching the one
  // the customer holds.
  const issued = invoice?.issued_date
    ? new Date(invoice.issued_date + "T00:00:00").toLocaleDateString("en-NZ")
    : new Date().toLocaleDateString("en-NZ");
  doc.text("Date: " + issued, LEFT, y); y += 6;
  doc.text("Customer: " + (job?.customers?.name || ""), LEFT, y); y += 5;
  doc.text(
    "Machine: " + [job?.machines?.type, job?.machines?.make, job?.machines?.model].filter(Boolean).join(" "),
    LEFT, y,
  );
  y += 10;

  // ---- Lines ----
  // Descriptions WRAP rather than truncate. The old code cut at 70 characters, so a
  // real job note ("Swing arm bearing sleeve seized. Required extra labour to…")
  // silently lost everything past the cut — on the document the customer receives.
  // Column layout. Quantity and unit price get their own columns rather than being
  // crammed into the description — cleaner to read, and NZ GST rules require the
  // quantity or volume supplied to appear on any tax invoice over $1,000.
  const QTY_X    = 128;         // right-aligned
  const UNIT_X   = 152;         // right-aligned
  const DESC_W   = 100;         // description wraps within this width
  const LINE_H   = 5;

  const newPage = () => { doc.addPage(); y = 20; };

  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text("Description", LEFT, y);
  doc.text("Qty", QTY_X, y, { align: "right" });
  doc.text("Unit", UNIT_X, y, { align: "right" });
  doc.text("Amount", RIGHT, y, { align: "right" });
  doc.setTextColor(0);
  doc.setFontSize(10);
  y += 2;
  doc.line(LEFT, y, RIGHT, y); y += 6;

  // Whole hours and whole units read better without trailing zeros: 3 not 3.00,
  // but 2.75 litres of oil keeps its decimals.
  const qtyLabel = (q) => {
    const n = Number(q ?? 0);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  };

  (items || []).forEach((it) => {
    const label =
      (it.kind === "labour" ? "Labour: " : "") + (it.description || "");
    const lines = doc.splitTextToSize(label, DESC_W);

    // Keep a line item together on one page.
    if (y + lines.length * LINE_H > BOTTOM) newPage();

    // Qty, unit price and amount sit on the first line; the description wraps below.
    doc.text(qtyLabel(it.quantity), QTY_X, y, { align: "right" });
    doc.text("$" + Number(it.unit_price).toFixed(2), UNIT_X, y, { align: "right" });
    doc.text("$" + Number(it.amount).toFixed(2), RIGHT, y, { align: "right" });
    lines.forEach((ln, i) => {
      doc.text(ln, LEFT, y + i * LINE_H);
    });
    y += lines.length * LINE_H + 2;
  });

  // ---- Notes from the workshop ----
  // What the mechanic wants the customer to know. Deliberately NOT job.notes,
  // which is the shop's internal field and goes out with the pick-up text.
  const workshopNotes = String(job?.customer_notes ?? "").trim();
  if (workshopNotes) {
    if (y + 20 > BOTTOM) newPage();
    y += 4;
    doc.setFontSize(10);
    doc.setFont(undefined, "bold");
    doc.text("Notes from the workshop", LEFT, y);
    doc.setFont(undefined, "normal");
    y += 6;
    doc.splitTextToSize(workshopNotes, RIGHT - LEFT).forEach((ln) => {
      if (y > BOTTOM) newPage();
      doc.text(ln, LEFT, y);
      y += LINE_H;
    });
    y += 4;
  }

  // ---- Totals ----
  if (y + 30 > BOTTOM) newPage();
  y += 2; doc.line(120, y, RIGHT, y); y += 6;
  doc.text("Subtotal", 120, y);
  doc.text("$" + Number(invoice?.subtotal).toFixed(2), RIGHT, y, { align: "right" }); y += 5;
  doc.text("GST 15%", 120, y);
  doc.text("$" + Number(invoice?.gst).toFixed(2), RIGHT, y, { align: "right" }); y += 6;
  doc.setFontSize(12);
  doc.text("Total", 120, y);
  doc.text("$" + Number(invoice?.total).toFixed(2), RIGHT, y, { align: "right" });
  y += 12;

  // ---- Payment terms ----
  // Stated in words AND as a date. The words are the agreement; the date is what
  // stops an argument about what "the 20th following" meant for this invoice.
  doc.setFontSize(10);
  doc.text(termsLabel(invoice?.payment_terms), LEFT, y);
  if (invoice?.due_date) {
    const due = new Date(invoice.due_date + "T00:00:00").toLocaleDateString("en-NZ", {
      day: "numeric", month: "long", year: "numeric",
    });
    doc.setFont(undefined, "bold");
    doc.text("Due: " + due, LEFT, y + 6);
    doc.setFont(undefined, "normal");
  }
  if (settings?.bank_account) {
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text("Please pay to " + settings.bank_account, LEFT, y + 13);
    doc.setTextColor(0);
    doc.setFontSize(10);
  }

  // ---- Footer, stamped on every page ----
  // Done at the end rather than per-page, because pages get added while the line
  // items are drawn — this way a three-page invoice gets three footers, not one.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    // Terms of trade — small, grey, wrapped to the full width.
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    const terms = doc.splitTextToSize(DISCLAIMER, RIGHT - LEFT);
    terms.forEach((ln, k) => doc.text(ln, LEFT, PAGE_H - 38 + k * 3.2));

    // Hairline, then the strapline.
    doc.setDrawColor(210);
    doc.line(LEFT, PAGE_H - 28, RIGHT, PAGE_H - 28);
    doc.setDrawColor(0);

    // The strapline is a piece of branding, not fine print — set larger and darker
    // than the terms above it so it reads as a sign-off rather than a legal note.
    doc.setFontSize(14);
    doc.setTextColor(70);
    doc.text(TAGLINE, PAGE_W / 2, PAGE_H - 20, { align: "center" });

    if (pages > 1) {
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`Page ${i} of ${pages}`, RIGHT, PAGE_H - 14, { align: "right" });
    }

    doc.setTextColor(0);
    doc.setFontSize(10);
  }

  return doc;
}

/** Base64 body only (no data: prefix) — what the send-invoice function expects. */
export function pdfToBase64(doc) {
  return doc.output("datauristring").split("base64,")[1];
}

/** A blob: URL for showing the PDF in an iframe. Caller should revoke it when done. */
export function pdfToObjectUrl(doc) {
  return URL.createObjectURL(doc.output("blob"));
}
