// send-reminder: authorize caller (approved staff), email a service reminder via Resend.
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

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Betterservice Tepuke <accounts@betterservice.co.nz>",
        to: [to],
        subject: "Time for a service — Betterservice Tepuke",
        html:
          `<p>Hi ${esc(customerName) || "there"},</p>` +
          `<p>It's Craig at Betterservice Tepuke. Our records show your <strong>${esc(machineLabel) || "bike"}</strong> is about due for its service — it's been roughly a year since the last one.</p>` +
          `<p>A regular service keeps it running sweet, safe and reliable. Give me a call or text on <strong>021 08327787</strong> to book it in.</p>` +
          `<p>Cheers,<br/>Craig · Betterservice Tepuke</p>`,
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || "Resend rejected the send." }, 400);
    return json({ ok: true, emailId: data.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
