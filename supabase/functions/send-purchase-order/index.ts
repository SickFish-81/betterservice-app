// send-purchase-order: authorize caller (approved staff), email the PO PDF to the supplier via Resend using the editable Settings template.
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
const DEFAULT_SUBJECT = "Purchase order #{number} — {business}";
const DEFAULT_BODY = "Hi {supplier},\n\nPlease find our purchase order #{number} attached as a PDF.\n\nAny questions, just reply to this email or call Craig on {phone}.\n\nCheers,\n{business}";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { to, supplierName, poNumber, pdfBase64, accessToken } = body;
    const no = String(poNumber ?? "").padStart(5, "0");
    if (!pdfBase64) return json({ error: "No PDF was provided." }, 400);
    if (!to) return json({ error: "This supplier has no email address on file." }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const token = accessToken || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    // AUTHZ: approved staff only.
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_approved_staff`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const ok = chk.ok ? await chk.json() : false;
    if (ok !== true) return json({ error: "Not authorised — sign in as approved staff." }, 403);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY is not set." }, 400);

    // Load the editable template + business details from Settings.
    const sres = await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?id=eq.1&select=*`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    const st = (sres.ok ? (await sres.json())[0] : null) || {};
    const business = st.business_name || "Betterservice Tepuke";
    const vars = { supplier: supplierName, number: no, business, phone: st.phone || "021 08327787" };
    const subject = applyTemplate(st.po_email_subject || DEFAULT_SUBJECT, vars);
    const html = toHtml(applyTemplate(st.po_email_body || DEFAULT_BODY, vars));

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${business} <accounts@betterservice.co.nz>`,
        to: [to],
        subject,
        html,
        attachments: [{ filename: `PurchaseOrder-${no}.pdf`, content: pdfBase64 }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || "Resend rejected the send." }, 400);
    return json({ ok: true, emailId: data.id, emailed: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
