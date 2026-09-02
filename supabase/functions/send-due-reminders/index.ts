// send-due-reminders: nightly, email the customers whose machine is due for a
// service. Mirrors send-statements — service-role + CRON_SECRET, called daily
// with the x-cron-secret header.
//
// This used to send by text via Twilio, which was never set up, so every night
// it answered "Twilio isn't set up yet" and sent nothing — with an HTTP 200, so
// nothing ever complained. Email instead, using the SAME editable template in
// Settings that the manual "send reminder" button uses, so the nightly job and
// the button say the same thing and Craig only has one wording to maintain.
//
// Who gets one is decided by due_for_email_reminder() in the database: serviced
// 12-18 months ago, has an email, hasn't opted out, and hasn't already been
// chased since their last service. reminders_per_day in Settings caps how many
// go out in a night, so a year of catch-up doesn't land in one hit.
//
// Needs: SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_API_KEY.
//
// Call with ?dry=1 to see who would be emailed, without sending anything.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND = Deno.env.get("RESEND_API_KEY");

const DEFAULT_SUBJECT = "Time for a service — {business}";
const DEFAULT_BODY =
  "Hi {customer},\n\nIt's Craig at {business}. Our records show your {machine} is about due for its service — it's been roughly a year since the last one.\n\nA regular service keeps it running sweet, safe and reliable. Give me a call or text on {phone} to book it in.\n\nCheers,\nCraig · {business}";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
async function sb(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function applyTemplate(tpl: unknown, vars: Record<string, unknown>) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (_m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? "") : `{${k}}`);
}
// The template is written as plain text in Settings, the way Craig would type
// it. Blank lines become paragraphs, single newlines become breaks.
function toHtml(text: string) {
  return String(text ?? "").split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden — set CRON_SECRET and pass it as the x-cron-secret header." }, 403);
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  try {
    if (!RESEND) return json({ ok: false, sent: 0, error: "RESEND_API_KEY is not set — no reminders sent." }, 500);

    const shop = (await (await sb("/rest/v1/shop_settings?id=eq.1&select=*")).json())[0] || {};
    const perDay = Math.max(0, Number(shop.reminders_per_day ?? 5));
    const business = shop.business_name || "Betterservice ATV";
    const phone = shop.phone || "021 08327787";
    const subjectTpl = shop.reminder_email_subject || DEFAULT_SUBJECT;
    const bodyTpl = shop.reminder_email_body || DEFAULT_BODY;

    const due = await (await sb("/rest/v1/rpc/due_for_email_reminder", {
      method: "POST",
      body: JSON.stringify({ p_limit: perDay }),
    })).json();
    if (!Array.isArray(due)) return json({ error: "Couldn't read who's due", detail: due }, 500);
    if (due.length === 0) return json({ ok: true, sent: 0, note: "Nobody due for a reminder." });

    if (dry) {
      return json({
        ok: true, dry: true, wouldSend: due.length,
        who: due.map((d) => ({ customer: d.customer_name, email: d.email, machine: d.machine_label, monthsSinceService: d.months })),
      });
    }

    let sent = 0;
    const errors: string[] = [];
    const done: Record<string, unknown>[] = [];

    for (const d of due) {
      const to = String(d.email ?? "").trim();
      if (!to) continue;
      const vars = { customer: d.customer_name, machine: d.machine_label || "bike", business, phone };

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${business} <admin@betterservice.co.nz>`,
          to: [to],
          subject: applyTemplate(subjectTpl, vars),
          html: toHtml(applyTemplate(bodyTpl, vars)),
        }),
      });

      if (r.ok) {
        sent++;
        done.push({ customer: d.customer_name, machine: d.machine_label, email: to });
        // Stamp the machine so this customer isn't chased again until they've
        // actually been back in — the same rule due_for_email_reminder() reads.
        await sb(`/rest/v1/machines?id=eq.${d.machine_id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ last_reminder_sent: new Date().toISOString() }),
        });
      } else {
        errors.push(`${d.customer_name} <${to}>: ${await r.text()}`);
      }
    }

    return json({ ok: true, sent, done, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
