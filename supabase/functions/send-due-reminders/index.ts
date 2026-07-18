// send-due-reminders: on a schedule, text customers whose machine is due for a service, via Twilio.
// Mirrors send-statements: service-role + CRON_SECRET (call it daily with the x-cron-secret header).
// Uses due_for_sms_reminder() for who to text and the editable sms_due_body template from Settings.
// Needs SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM set as secrets.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const AUTH = Deno.env.get("TWILIO_AUTH_TOKEN");
const FROM = Deno.env.get("TWILIO_FROM");

const DEFAULT_DUE_BODY = "Hi {customer}, it's Craig at {business}. Your {machine} is about due for a service — call or text {phone} to book it in. Cheers";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
async function sb(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
function toE164(raw: unknown) {
  let p = String(raw ?? "").replace(/[\s\-()]/g, "");
  if (!p) return "";
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("64")) return "+" + p;
  if (p.startsWith("0")) return "+64" + p.slice(1);
  return "+" + p;
}
function applyTemplate(tpl: unknown, vars: Record<string, unknown>) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (_m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? "") : `{${k}}`));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden — set CRON_SECRET and pass it as the x-cron-secret header." }, 403);
  }
  try {
    if (!SID || !AUTH || !FROM) {
      return json({ ok: false, sent: 0, error: "Twilio isn't set up yet — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM." });
    }
    const shop = (await (await sb("/rest/v1/shop_settings?id=eq.1&select=*")).json())[0] || {};
    const perDay = Math.max(0, Number(shop.reminders_per_day ?? 5));
    const business = shop.business_name || "Betterservice Tepuke";
    const phone = shop.phone || "021 08327787";
    const tpl = shop.sms_due_body || DEFAULT_DUE_BODY;

    const due = await (await sb("/rest/v1/rpc/due_for_sms_reminder", { method: "POST", body: JSON.stringify({ p_limit: perDay }) })).json();
    if (!Array.isArray(due) || due.length === 0) return json({ ok: true, sent: 0, note: "None due." });

    let sent = 0;
    const errors: string[] = [];
    for (const d of due) {
      const to = toE164(d.phone);
      if (!to) continue;
      const body = applyTemplate(tpl, { customer: d.customer_name, machine: d.machine_label || "bike", business, phone });
      const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${SID}:${AUTH}`), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: FROM, To: to, Body: body }).toString(),
      });
      const data = await tw.json().catch(() => ({}));
      const okSend = tw.ok;
      await sb("/rest/v1/sms_messages", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ customer_id: d.customer_id, to_phone: to, body, status: okSend ? "sent" : "failed", provider_id: (data as { sid?: string })?.sid || null, error: okSend ? null : ((data as { message?: string })?.message || "Twilio rejected the send.") }),
      });
      if (okSend) {
        sent++;
        // Stamp the machine so it isn't texted again this cycle (mirrors the due_for_sms_reminder rule).
        await sb(`/rest/v1/machines?id=eq.${d.machine_id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_reminder_sent: new Date().toISOString() }) });
      } else {
        errors.push((data as { message?: string })?.message || "send failed");
      }
    }
    return json({ ok: true, sent, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
