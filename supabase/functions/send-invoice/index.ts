// send-invoice: file the invoice PDF and email it to the customer.
//
// THIS FILE WAS TWO VERSIONS BEHIND PRODUCTION until 17 Sep 2026. The repo copy
// still had the ORIGINAL logic, which logged nothing, marked nothing, and
// reported success whether or not the email went. Deploying it would have
// silently undone the email_log work and the sent-only-if-emailed guard. The
// body below is production v20, read back from Supabase, verbatim.
//
// The rule this function exists to enforce: AN INVOICE IS MARKED SENT ONLY IF
// RESEND ACCEPTED THE EMAIL. No address on file, or a rejection, leaves it
// unsent - filed, logged as failed, still on the unsent list - because an
// invoice that reads "sent" while the customer has nothing is the worst outcome
// available.
//
// It also returns `recorded`: emailed but not marked. That means the customer
// HAS the invoice and the database does not know it, which the caller surfaces
// rather than swallowing.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function applyTemplate(tpl: unknown, vars: Record<string, unknown>) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (_m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? "") : `{${k}}`));
}
function toHtml(text: string) {
  return String(text ?? "").split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
}
const DEFAULT_SUBJECT = "Your invoice #{number} — {business}";
const DEFAULT_BODY = "Hi {customer},\n\nThanks for choosing {business}. Your invoice #{number} for ${total} is attached as a PDF.\n\nAny questions, just reply to this email or call Craig on {phone}.\n\nCheers,\n{business}";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Server-side writes: marking an invoice sent, and writing the log. Uses the
// service role because email_log has no insert policy by design.
async function svc(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
}

// Best effort. A logging failure must never stop, or undo, an email that has
// already gone to a customer.
async function logEmail(row: Record<string, unknown>) {
  try {
    await svc("/rest/v1/email_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch (_) { /* ignored on purpose */ }
}

// The token has already been verified by current_staff_can_send below, so its
// claims can be read without re-verifying the signature here.
function userIdFromToken(t: string): string | null {
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p?.sub ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { to, customerName, invoiceNumber, total, pdfBase64, accessToken } = body;
    const invNo = String(invoiceNumber ?? "").padStart(5, "0");
    if (!pdfBase64) return json({ error: "No PDF was provided to file." }, 400);

    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const token = accessToken || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    // AUTHZ: only an approved owner who can send invoices may proceed.
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/current_staff_can_send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const canSend = chk.ok ? await chk.json() : false;
    if (canSend !== true) return json({ error: "Not authorised — only an owner who can send invoices can do this." }, 403);

    const actor = userIdFromToken(token);

    // Find the invoice row so the send can be recorded against it.
    // invoice_number is unique, so this matches at most one. If it does not
    // match, we still email -- refusing to invoice a customer because of a
    // bookkeeping miss would be the wrong trade -- but we say so in the reply.
    let inv: { id: string; customer_id: string | null } | null = null;
    if (invoiceNumber !== undefined && invoiceNumber !== null && invoiceNumber !== "") {
      const ires = await svc(`/rest/v1/invoices?invoice_number=eq.${encodeURIComponent(String(invoiceNumber))}&select=id,customer_id&limit=1`);
      if (ires.ok) {
        const rows = await ires.json().catch(() => []);
        if (Array.isArray(rows) && rows.length === 1) inv = rows[0];
      }
    }

    // File the PDF as the caller (matches the 'authenticated' storage policy).
    const cleanB64 = String(pdfBase64).replace(/^data:[^;]+;base64,/, "");
    const bytes = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0));
    const _now = new Date();
    const _month = `${_now.getUTCFullYear()}-${String(_now.getUTCMonth() + 1).padStart(2, "0")}`;
    const path = `invoices/${_month}/invoice-${invoiceNumber}-${Date.now()}.pdf`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/invoices/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/pdf" },
      body: bytes,
    });
    if (!up.ok) return json({ error: `Storage upload failed (${up.status}): ${await up.text()}` }, 400);

    // Record where it was filed, so the filed copy is findable later.
    if (inv) {
      await svc(`/rest/v1/invoices?id=eq.${inv.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ pdf_url: path }),
      }).catch(() => {});
    }

    // Load the editable template + business details from Settings.
    const sres = await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?id=eq.1&select=*`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    const st = (sres.ok ? (await sres.json())[0] : null) || {};
    const business = st.business_name || "Betterservice Tepuke";
    const vars = { customer: customerName, number: invNo, total: Number(total || 0).toFixed(2), business, phone: st.phone || "021 08327787" };
    // Where the shop's own copy goes. Ignored if it isn't a plausible address, so a
    // typo in Settings can never stop an invoice reaching the customer.
    const bccRaw = String(st.invoice_bcc ?? "").trim();
    const bcc = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bccRaw) ? bccRaw : "";

    const subject = applyTemplate(st.invoice_email_subject || DEFAULT_SUBJECT, vars);
    const html = toHtml(applyTemplate(st.invoice_email_body || DEFAULT_BODY, vars));

    let emailId: string | null = null;
    let emailError: string | null = null;
    const apiKey = Deno.env.get("RESEND_API_KEY");

    if (to && apiKey) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${business} <accounts@betterservice.co.nz>`,
          to: [to],
          // Shop's own copy of every invoice sent. Blind, so the customer never sees
          // it. Address lives in Settings (invoice_bcc) — blank it to stop the copies.
          ...(bcc ? { bcc: [bcc] } : {}),
          subject,
          html,
          attachments: [{ filename: `Invoice-${invNo}.pdf`, content: cleanB64 }],
        }),
      });
      const data = await r.json().catch(() => ({} as Record<string, string>));
      if (!r.ok) emailError = data?.message || "Resend rejected the send.";
      else emailId = data.id ?? null;
    } else if (to && !apiKey) {
      emailError = "RESEND_API_KEY is not set.";
    } else if (!to) {
      emailError = "No email on file for this customer — invoice filed but not emailed.";
    }

    // Write the record. Every branch above lands in exactly one of these.
    await logEmail({
      kind: "job_invoice",
      subject,
      to_email: to || null,
      bcc_email: emailId ? (bcc || null) : null,
      invoice_id: inv?.id ?? null,
      customer_id: inv?.customer_id ?? null,
      sent_by: actor,
      resend_id: emailId,
      status: emailId ? "accepted" : "failed",
      error: emailError ? String(emailError).slice(0, 2000) : null,
    });

    // Only now, and only if it genuinely went, is the invoice marked sent.
    let recorded = false;
    if (emailId && inv) {
      const mark = await svc(`/rest/v1/invoices?id=eq.${inv.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          sent: true,
          sent_at: new Date().toISOString(),
          ...(actor ? { sent_by: actor } : {}),
        }),
      });
      const rows = mark.ok ? await mark.json().catch(() => []) : [];
      recorded = Array.isArray(rows) && rows.length === 1;
    }

    return json({
      ok: true,
      pdfPath: path,
      emailId,
      emailError,
      emailed: !!emailId,
      copiedTo: emailId ? bcc || null : null,
      // New. If emailed is true but recorded is false, the customer HAS the
      // invoice and the database does not know it -- worth surfacing rather than
      // swallowing, because that is the exact fault this version exists to end.
      recorded,
      invoiceFound: !!inv,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
