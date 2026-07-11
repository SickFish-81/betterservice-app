// send-invoice: authorize caller (owner who can send), file the PDF, email via Resend.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { to, customerName, invoiceNumber, total, pdfBase64, accessToken } = body;
    if (!pdfBase64) return json({ error: "No PDF was provided to file." }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
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

    // File the PDF as the caller (matches the 'authenticated' storage policy).
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const path = `invoice-${invoiceNumber}-${Date.now()}.pdf`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/invoices/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/pdf" },
      body: bytes,
    });
    if (!up.ok) return json({ error: `Storage upload failed (${up.status}): ${await up.text()}` }, 400);
    let emailId: string | null = null;
    let emailError: string | null = null;
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (to && apiKey) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Betterservice Tepuke <accounts@betterservice.co.nz>",
          to: [to],
          subject: `Your invoice #${invoiceNumber} — Betterservice Tepuke`,
          html:
            `<p>Hi ${esc(customerName) || "there"},</p>` +
            `<p>Thanks for choosing Betterservice Tepuke. Your invoice <strong>#${esc(invoiceNumber)}</strong> ` +
            `for <strong>$${Number(total || 0).toFixed(2)}</strong> is attached as a PDF.</p>` +
            `<p>Any questions, just reply to this email or call Craig on 021 08327787.</p>` +
            `<p>Cheers,<br/>Betterservice Tepuke</p>`,
          attachments: [{ filename: `Invoice-${invoiceNumber}.pdf`, content: pdfBase64 }],
        }),
      });
      const data = await r.json();
      if (!r.ok) emailError = data?.message || "Resend rejected the send.";
      else emailId = data.id;
    } else if (to && !apiKey) {
      emailError = "RESEND_API_KEY is not set.";
    } else if (!to) {
      emailError = "No email on file for this customer — invoice filed but not emailed.";
    }

    return json({ ok: true, pdfPath: path, emailId, emailError, emailed: !!emailId });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
