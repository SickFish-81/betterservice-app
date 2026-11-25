// labelSheetPdf.js — the FLIP label sheet as a PDF.
//
// WHY THERE IS A PDF AT ALL
//
// The label sheet is an HTML page and "Print this sheet" used to be
// window.print(). That works in every browser except one that matters: the
// Betterservice app opened from its Home Screen icon on Craig's iPad. Apple
// ignores window.print() in a Home Screen web app. Nothing happens, nothing
// errors, and the label doesn't print (Craig, email "Printing", 26 Nov 2026).
// He added the icon on 14 Oct so dispatch notifications would reach him, so
// he will keep opening the app that way.
//
// A PDF file can be printed from anywhere on the iPad: the page hands it to the
// share sheet, and Print is on the share sheet. So on an iPad or iPhone the
// button shares this PDF, whether the app was opened from the icon or in
// Safari. A desktop browser keeps printing the HTML page, which has always
// worked there.
//
// KEEP IT MATCHING THE PAGE
//
// This draws the same sheet as app/flip-orders/[invoice]/label/page.js: where
// it's going on the top half, what goes in the box on the bottom half, a cut
// line between. The page works out every value (sender, collect, dropship,
// freight line) and passes them in, so the decisions live in one place and
// this file only draws. If the page's sheet changes, change this too.
//
// No React, no Supabase: plain data in, a jsPDF document out.

import { usePdfFont } from "./pdfFont";

const PAGE_W = 210;
const HALF = 148.5;
const PT = 0.3528; // mm per point

const INK = [0, 0, 0];
const GREY = [113, 113, 122];     // zinc-500
const DARKGREY = [82, 82, 91];    // zinc-600
const LIGHTGREY = [161, 161, 170]; // zinc-400
const RULE = [212, 212, 216];     // zinc-300

export const labelSheetFileName = (invoiceNumber) => `FLIP-${invoiceNumber}-label-sheet.pdf`;

/**
 * Draw the sheet.
 *
 * @param {object} s
 * @param {number} s.invoiceNumber
 * @param {string|null} s.labelSrc      data: URL of the GoSweetSpot label PNG, if booked
 * @param {string|null} s.trackingNumber
 * @param {boolean} s.collect
 * @param {string} s.name
 * @param {string[]} s.addressLines
 * @param {string} s.addressOneLine
 * @param {string|null} s.phone
 * @param {string|null} s.note          delivery instructions
 * @param {boolean} s.rural
 * @param {{name: string, lines: string[], phone: string|null}} s.sender
 * @param {string|null} s.tradeFor      "Trade order for X" line, when it's a dropship
 * @param {{qty: number, name: string, sku: string}[]} s.items
 * @param {string} s.orderedLine
 * @param {string} s.freightLine
 * @returns {Promise<import("jspdf").jsPDF>}
 */
export async function buildLabelSheetPdf(s) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await usePdfFont(doc);

  const font = (size, bold = false, color = INK) => {
    doc.setFont(undefined, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const caps = (str, x, y, opts = {}) => doc.text(String(str).toUpperCase(), x, y, { charSpace: 0.45, ...opts });
  const lh = (size, factor = 1.25) => size * PT * factor;

  // ------------------------------------------------ top half: where it goes
  if (s.labelSrc) {
    // The carrier's own label, as large as the half allows and never
    // stretched: a squashed barcode doesn't scan.
    const props = doc.getImageProperties(s.labelSrc);
    const maxW = 190, maxH = 124;
    const scale = Math.min(maxW / props.width, maxH / props.height);
    const w = props.width * scale, h = props.height * scale;
    const x = (PAGE_W - w) / 2;
    const y = 10 + (maxH - h) / 2;
    doc.addImage(s.labelSrc, "PNG", x, y, w, h, undefined, "FAST");
    font(9, false, GREY);
    doc.text(`FLIP-${s.invoiceNumber}${s.trackingNumber ? " · " + s.trackingNumber : ""}`, PAGE_W / 2, 140, { align: "center" });
  } else {
    const L = 14, R = PAGE_W - 14;
    font(9, true, GREY);
    caps(s.collect ? "For collection by" : "Deliver to", L, 20);
    caps("Order", R, 20, { align: "right" });
    font(22, true);
    doc.text(`FLIP-${s.invoiceNumber}`, R, 29, { align: "right" });

    let y = 29;
    font(20, true);
    for (const line of doc.splitTextToSize(s.name || "—", 120)) { doc.text(line, L, y); y += lh(20, 1.1); }
    y += 1;
    font(14);
    const addr = s.collect
      ? ["Customer collects from the workshop"]
      : s.addressLines.length ? s.addressLines : ["No address recorded"];
    for (const line of addr) {
      for (const part of doc.splitTextToSize(line, 125)) { doc.text(part, L, y); y += lh(14); }
    }
    if (s.phone) { y += 2; font(12); doc.text(`Ph ${s.phone}`, L, y); y += lh(12); }

    // The instruction a hand-copied address loses. Printed big on purpose.
    if (s.note) {
      y += 4;
      doc.setDrawColor(...INK); doc.setLineWidth(0.7);
      doc.line(L, y, R, y);
      y += 5;
      font(9, true); caps("Delivery instructions", L, y);
      y += lh(15, 1.1);
      font(15, true);
      for (const part of doc.splitTextToSize(s.note, R - L)) { doc.text(part, L, y); y += lh(15, 1.2); }
      y -= 2;
      doc.line(L, y, R, y);
      y += 2;
    }
    if (s.rural) { y += 6; font(11, true); caps("Rural delivery", L, y); }

    // Sender, at the foot of the top half.
    const footTop = 120;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
    doc.line(L, footTop, R, footTop);
    let fy = footTop + 5;
    font(9, true, GREY); caps("From", L, fy); fy += lh(9);
    font(9, true); doc.text(s.sender.name, L, fy); fy += lh(9);
    font(9, false, DARKGREY);
    for (const l of s.sender.lines) { doc.text(l, L, fy); fy += lh(9); }
    if (s.sender.phone) doc.text(`Ph ${s.sender.phone}`, L, fy);
    doc.text(s.collect ? "Keep this half with the box until it's collected" : "Stick the courier ticket on this half", R, footTop + 5, { align: "right" });
  }

  // ------------------------------------------------------- the cut line
  doc.setDrawColor(...LIGHTGREY); doc.setLineWidth(0.3);
  doc.setLineDashPattern([2, 1.5], 0);
  doc.line(0, HALF, PAGE_W, HALF);
  doc.setLineDashPattern([], 0);
  font(8, false, LIGHTGREY);
  const cutW = doc.getTextWidth("CUT HERE") + 0.6 * 8 + 6;
  doc.setFillColor(255, 255, 255);
  doc.rect((PAGE_W - cutW) / 2, HALF - 2.2, cutW, 4.4, "F");
  caps("Cut here", PAGE_W / 2, HALF + 1, { align: "center", charSpace: 0.6 });

  // ------------------------------------------- bottom half: what goes in
  const L = 14, R = PAGE_W - 14;
  let y = HALF + 18;
  font(18, true); doc.text(`FLIP-${s.invoiceNumber}`, L, y);
  font(11, true, GREY); caps("Pack this", R, y, { align: "right" });
  y += lh(11, 1.6);
  font(11, true); doc.text(s.name || "—", L, y); y += lh(10, 1.35);
  font(10, false, DARKGREY);
  for (const part of doc.splitTextToSize(s.collect ? "Customer collects from the workshop" : (s.addressOneLine || "No address recorded"), R - L)) {
    doc.text(part, L, y); y += lh(10, 1.3);
  }
  if (s.tradeFor) { doc.text(s.tradeFor, L, y); y += lh(10, 1.3); }
  if (s.note) {
    font(11, true);
    for (const part of doc.splitTextToSize(s.note, R - L)) { doc.text(part, L, y); y += lh(11, 1.3); }
  }

  y += 6;
  for (const it of s.items) {
    const rowTop = y;
    doc.setDrawColor(...INK); doc.setLineWidth(0.6);
    doc.rect(L, rowTop, 5, 5);
    font(14, true);
    const qty = `${it.qty} ×`;
    doc.text(qty, L + 8, rowTop + 4.4);
    const nameX = L + 8 + doc.getTextWidth(qty) + 3;
    font(9, false, LIGHTGREY);
    if (it.sku) doc.text(String(it.sku), R, rowTop + 4.2, { align: "right" });
    const skuW = it.sku ? doc.getTextWidth(String(it.sku)) + 4 : 0;
    font(13);
    const lines = doc.splitTextToSize(String(it.name || it.sku || ""), R - skuW - nameX);
    lines.forEach((part, i) => doc.text(part, nameX, rowTop + 4.4 + i * lh(13, 1.2)));
    y = rowTop + 4.4 + (lines.length - 1) * lh(13, 1.2) + 3;
    doc.setDrawColor(228, 228, 231); doc.setLineWidth(0.3);
    doc.line(L, y, R, y);
    y += 3;
  }

  const footY = 297 - 14;
  doc.setDrawColor(...RULE); doc.setLineWidth(0.3);
  doc.line(L, footY - 6, R, footY - 6);
  font(9, false, DARKGREY);
  doc.text(s.orderedLine, L, footY);
  doc.text(s.freightLine, R, footY, { align: "right" });

  return doc;
}
