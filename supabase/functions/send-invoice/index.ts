// Supabase Edge Function: send-invoice
// Files the invoice PDF into storage (as the signed-in staff member), then emails it via Resend.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { to, customerName, invoiceNumber, total, pdfBase64, accessToken } = body;
    if (!pdfBase64) return json({ error: "No PDF was provided to file." }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const uploadAuth = accessToken ? `Bearer ${accessToken}` : (req.headers.get("Authorization") || `Bearer ${ANON_KEY}`);

    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const path = `invoice-${invoiceNumber}-${Date.now()}.pdf`;
    // Plain insert (no x-upsert) — the path is unique, and upsert triggers an update path that RLS blocks.
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/invoices/${path}`, {
      method: "POST",
      headers: { Authorization: uploadAuth, apikey: ANON_KEY, "Content-Type": "application/pdf" },
      body: bytes,
    });
    if (!up.ok) return json({ error: `Storage upload failed (${up.status}): ${await up.text()}` }, 400);
    const pdfUrl = `${SUPABASE_URL}/storage/v1/object/public/invoices/${path}`;

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
            `<p>Hi ${customerName || "there"},</p>` +
            `<p>Thanks for choosing Betterservice Tepuke. Your invoice <strong>#${invoiceNumber}</strong> ` +
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
    }

    return json({ ok: true, pdfUrl, emailId, emailError, emailed: !!emailId });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
