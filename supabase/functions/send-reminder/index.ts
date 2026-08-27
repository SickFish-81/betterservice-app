// send-reminder: authorize caller (approved staff), email a service reminder via Resend using the editable Settings template.
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
const DEFAULT_SUBJECT = "Time for a service — {business}";
const DEFAULT_BODY = "Hi {customer},\n\nIt's Craig at {business}. Our records show your {machine} is about due for its service — it's been roughly a year since the last one.\n\nA regular service keeps it running sweet, safe and reliable. Give me a call or text on {phone} to book it in.\n\nCheers,\nCraig · {business}";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { to, customerName, machineLabel, accessToken } = await req.json().catch(() => ({}));
    if (!to) return json({ error: "No email on file for this customer." }, 400);

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
    if (ok !== true) return json({ error: "Not authorised." }, 403);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY is not set." }, 500);

    // Load the editable template + business details from Settings.
    const sres = await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?id=eq.1&select=*`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    const st = (sres.ok ? (await sres.json())[0] : null) || {};
    const business = st.business_name || "Betterservice ATV";
    const vars = { customer: customerName, machine: machineLabel || "bike", business, phone: st.phone || "021 08327787" };
    const subject = applyTemplate(st.reminder_email_subject || DEFAULT_SUBJECT, vars);
    const html = toHtml(applyTemplate(st.reminder_email_body || DEFAULT_BODY, vars));

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${business} <admin@betterservice.co.nz>`, to: [to], subject, html }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || "Resend rejected the send." }, 400);
    return json({ ok: true, emailId: data.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
