// send-sms: authorize caller (approved staff), text a number via Twilio, and log it to sms_messages.
// Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM set in Supabase project secrets
// (mirrors how email uses RESEND_API_KEY).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// NZ-friendly E.164 normaliser (Twilio needs +64…).
function toE164(raw: unknown) {
  let p = String(raw ?? "").replace(/[\s\-()]/g, "");
  if (!p) return "";
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("64")) return "+" + p;
  if (p.startsWith("0")) return "+64" + p.slice(1);
  return "+" + p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { to, body, customerId, accessToken } = await req.json().catch(() => ({}));
    const phone = toE164(to);
    if (!phone) return json({ error: "No phone number to text." }, 400);
    if (!body) return json({ error: "No message to send." }, 400);

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

    const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
    const AUTH = Deno.env.get("TWILIO_AUTH_TOKEN");
    const FROM = Deno.env.get("TWILIO_FROM");
    if (!SID || !AUTH || !FROM) {
      return json({ error: "Texting isn't switched on yet — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in the Supabase project secrets." }, 500);
    }

    // Send via Twilio.
    const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${SID}:${AUTH}`), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: FROM, To: phone, Body: String(body) }).toString(),
    });
    const data = await tw.json().catch(() => ({}));
    const sent = tw.ok;
    const sid = (data as { sid?: string })?.sid || null;
    const errText = sent ? null : ((data as { message?: string })?.message || "Twilio rejected the send.");

    // Log the text (best-effort; RLS lets approved staff insert).
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ customer_id: customerId || null, to_phone: phone, body: String(body), status: sent ? "sent" : "failed", provider_id: sid, error: errText }),
    }).catch(() => {});

    if (!sent) return json({ error: errText }, 400);
    return json({ ok: true, sid });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
