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

export const invNo = (n) => String(n ?? 0).padStart(4, "0");
export const invoiceFileName = (invoice) => `Invoice-${invNo(invoice?.invoice_number)}.pdf`;

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
  let y = 20;

  // ---- Shop header ----
  doc.setFontSize(18);
  doc.text(settings?.business_name || "Betterservice Te Puke", 20, y);
  y += 7;

  doc.setFontSize(10);
  if (settings?.address) { doc.text(settings.address, 20, y); y += 5; }
  if (settings?.phone)   { doc.text("Ph: " + settings.phone, 20, y); y += 5; }
  doc.text(
    [
      "GST #: " + (settings?.gst_number || "-"),
      settings?.bank_account ? "Bank: " + settings.bank_account : "",
    ].filter(Boolean).join("    "),
    20, y,
  );
  y += 12;

  // ---- Invoice header ----
  doc.setFontSize(14);
  doc.text("TAX INVOICE  #" + invNo(invoice?.invoice_number), 20, y);
  y += 8;

  doc.setFontSize(10);
  // The invoice's OWN issue date, not today. Reprinting an old invoice must show
  // the date it was actually issued, or the copy on file stops matching the one
  // the customer holds.
  const issued = invoice?.issued_date
    ? new Date(invoice.issued_date + "T00:00:00").toLocaleDateString("en-NZ")
    : new Date().toLocaleDateString("en-NZ");
  doc.text("Date: " + issued, 20, y); y += 6;
  doc.text("Customer: " + (job?.customers?.name || ""), 20, y); y += 5;
  doc.text(
    "Machine: " + [job?.machines?.type, job?.machines?.make, job?.machines?.model].filter(Boolean).join(" "),
    20, y,
  );
  y += 10;

  // ---- Lines ----
  doc.line(20, y, 190, y); y += 6;
  (items || []).forEach((it) => {
    const desc =
      (it.kind === "labour" ? "Labour: " : "") +
      (it.description || "") +
      "  (" + it.quantity + " x $" + Number(it.unit_price).toFixed(2) + ")";
    doc.text(desc.substring(0, 70), 20, y);
    doc.text("$" + Number(it.amount).toFixed(2), 190, y, { align: "right" });
    y += 6;
  });

  // ---- Totals ----
  y += 2; doc.line(120, y, 190, y); y += 6;
  doc.text("Subtotal", 120, y);
  doc.text("$" + Number(invoice?.subtotal).toFixed(2), 190, y, { align: "right" }); y += 5;
  doc.text("GST 15%", 120, y);
  doc.text("$" + Number(invoice?.gst).toFixed(2), 190, y, { align: "right" }); y += 6;
  doc.setFontSize(12);
  doc.text("Total", 120, y);
  doc.text("$" + Number(invoice?.total).toFixed(2), 190, y, { align: "right" });

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
