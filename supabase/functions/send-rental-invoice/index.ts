// send-rental-invoice: the half of the old rent run that actually reaches a tenant.
//
// generate-rental-invoices prepares the invoice and files its PDF, then stops.
// This is what Craig triggers from Rentals > Awaiting approval once he has
// looked at it. Splitting the two is the whole point: preparing is automatic
// and safe to repeat, sending is deliberate and happens once.
//
// It emails the PDF THAT WAS ALREADY FILED rather than building a new one, so
// what the tenant receives is byte-for-byte what Craig approved.
//
// The lease letter moved here with the sending. It goes out once per tenancy,
// with the first invoice — a file uploaded against the agreement wins (that's
// the signed or lawyer-drafted version), otherwise it is rendered from the
// editable template in Settings so Craig can reword it without a deploy.
//
// Needs: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RESEND_API_KEY.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND = Deno.env.get("RESEND_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
async function sb(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
const money = (n: unknown) => "$" + Number(n || 0).toFixed(2);
const invNo = (n: unknown) => "#" + String(n).padStart(5, "0");
const nzDate = (d: unknown) => (d ? new Date(String(d) + "T00:00:00Z").toLocaleDateString("en-NZ", { timeZone: "UTC" }) : "");
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function applyTemplate(tpl: unknown, vars: Record<string, unknown>) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (_m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? "") : `{${k}}`);
}

// pdf-lib neither wraps nor paginates, so both are done here.
async function buildLetterPdf(body: string) {
  const { PDFDocument, StandardFonts } = await import("https://esm.sh/pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const SIZE = 11, LEAD = 15, LEFT = 50, TOP = 790, BOTTOM = 60, WIDTH = 495;

  const lines: string[] = [];
  for (const para of String(body ?? "").split(/\r?\n/)) {
    if (!para.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of para.trim().split(/\s+/)) {
      const test = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(test, SIZE) > WIDTH && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }

  let page = pdf.addPage([595, 842]);
  let y = TOP;
  for (const ln of lines) {
    if (y < BOTTOM) { page = pdf.addPage([595, 842]); y = TOP; }
    if (ln) page.drawText(ln, { x: LEFT, y, size: SIZE, font });
    y -= LEAD;
  }
  return await pdf.saveAsBase64();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { invoiceId, sentBy, accessToken } = await req.json().catch(() => ({}));
    if (!invoiceId) return json({ error: "Which invoice?" }, 400);

    const token = accessToken || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    // AUTHZ: same gate as send-invoice — an approved owner who can send.
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/current_staff_can_send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    if ((chk.ok ? await chk.json() : false) !== true) {
      return json({ error: "Not authorised — only an owner who can send invoices can do this." }, 403);
    }

    const invRes = await sb(
      `/rest/v1/invoices?id=eq.${invoiceId}&select=id,invoice_number,total,issued_date,due_date,period_start,sent,kind,pdf_url,rental_agreement_id`
    );
    const inv = (await invRes.json())[0];
    if (!inv) return json({ error: "No such invoice." }, 404);
    if (inv.kind !== "rental") return json({ error: "That isn't a rental invoice — job cards send through send-invoice." }, 400);
    // Idempotent on purpose: a double-click must not email a tenant twice.
    if (inv.sent) return json({ ok: true, already: true, note: "Already sent — nothing done." });
    if (!inv.pdf_url) return json({ error: "No filed PDF for this invoice. Re-run the rent job before sending." }, 400);

    const agRes = await sb(
      `/rest/v1/rental_agreements?id=eq.${inv.rental_agreement_id}&select=id,start_date,lease_pdf_path,lease_sent_at,customers(name,email,company_name),rental_units(name)`
    );
    const ag = (await agRes.json())[0];
    if (!ag) return json({ error: "This invoice isn't linked to a tenancy." }, 400);
    const to = ag.customers?.email;
    if (!to) return json({ error: `No email address on file for ${ag.customers?.name || "this tenant"} — add one under Customers first.` }, 400);

    const shop = (await (await sb("/rest/v1/shop_settings?id=eq.1&select=*")).json())[0] || {};
    const business = shop.business_name || "Betterservice ATV";
    const bccRaw = String(shop.invoice_bcc ?? "").trim();
    const bcc = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bccRaw) ? bccRaw : "";

    // The approved PDF, exactly as filed.
    const pdfRes = await fetch(`${SUPABASE_URL}/storage/v1/object/invoices/${inv.pdf_url}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!pdfRes.ok) return json({ error: `Couldn't read the filed PDF (${pdfRes.status}).` }, 400);
    const attachments: Record<string, string>[] = [
      { filename: `Invoice-${String(inv.invoice_number).padStart(5, "0")}.pdf`, content: b64(new Uint8Array(await pdfRes.arrayBuffer())) },
    ];

    let leaseSent = false;
    if (!ag.lease_sent_at) {
      if (ag.lease_pdf_path) {
        const lr = await fetch(`${SUPABASE_URL}/storage/v1/object/${ag.lease_pdf_path}`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        if (lr.ok) { attachments.push({ filename: "Lease-Agreement.pdf", content: b64(new Uint8Array(await lr.arrayBuffer())) }); leaseSent = true; }
      } else if (shop.lease_letter_body) {
        const letter = applyTemplate(shop.lease_letter_body, {
          customer: ag.customers?.name || "",
          unit: ag.rental_units?.name || "",
          date: nzDate(inv.issued_date),
          start: nzDate(ag.start_date),
        });
        attachments.push({ filename: "Lease-Agreement.pdf", content: await buildLetterPdf(letter) });
        leaseSent = true;
      }
    }

    if (!RESEND) return json({ error: "RESEND_API_KEY isn't set — nothing was sent." }, 500);
    const covers = nzDate(inv.period_start);
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${business} <admin@betterservice.co.nz>`,
        to: [to],
        ...(bcc ? { bcc: [bcc] } : {}),
        subject: `Rent invoice ${invNo(inv.invoice_number)} — ${esc(ag.rental_units?.name || "unit")}`,
        html:
          `<p>Hi ${esc(ag.customers?.name || "there")},</p>` +
          `<p>Your rent invoice for <strong>${esc(ag.rental_units?.name)}</strong> is attached — <strong>${money(inv.total)}</strong>, due ${nzDate(inv.due_date)}.</p>` +
          (leaseSent ? `<p>Your lease agreement is attached as well, for your records.</p>` : "") +
          `<p>This is collected by automatic payment, so there's nothing to do — the invoice is for your records.</p>` +
          `<p>Cheers,<br/>${esc(business)}</p>`,
        attachments,
      }),
    });
    if (!er.ok) return json({ error: `The email was rejected: ${await er.text()}` }, 400);

    // Only now is it sent. If the email failed above we never get here, so an
    // invoice can never be marked sent without having actually gone.
    await sb(`/rest/v1/invoices?id=eq.${inv.id}`, {
      method: "PATCH",
      body: JSON.stringify({ sent: true, sent_at: new Date().toISOString(), ...(sentBy ? { sent_by: sentBy } : {}) }),
    });
    if (leaseSent) {
      await sb(`/rest/v1/rental_agreements?id=eq.${ag.id}`, {
        method: "PATCH", body: JSON.stringify({ lease_sent_at: new Date().toISOString() }),
      });
    }

    return json({ ok: true, invoice: invNo(inv.invoice_number), to, lease: leaseSent, covers });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
