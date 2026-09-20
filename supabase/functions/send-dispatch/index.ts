// send-dispatch: tell a member of staff about a pick-up — on their phone, and in
// their inbox.
//
// This replaces send-sms for pick-up dispatch. Texting New Zealand numbers means
// a telco account, business verification and a monthly bill, for a handful of
// messages a month; not one text was ever sent. A web push costs nothing and
// arrives the same way.
//
// BOTH channels go, on purpose, because they fail in opposite ways. A push is
// immediate and impossible to miss, and gone the moment it's swiped away. An
// email is easy to ignore and still there tomorrow when you're standing in a
// yard trying to remember which shed. Craig asked for both.
//
// Neither failing stops the other: a person with no phone registered still gets
// the email, and a bounced email doesn't cost them the notification.
//
// Needs: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, RESEND_API_KEY,
//        VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const RESEND = Deno.env.get("RESEND_API_KEY");
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@betterservice.co.nz";

// Where the "open the job card" link points. This used to be the raw
// betterservice-app.vercel.app address — the one deliberately kept out of
// Google — which works but looks wrong to anyone reading the email. Named
// rather than inlined so the next link added here cannot drift from it.
const APP_URL = "https://betterservice.co.nz";

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
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
// Best effort — a logging failure must never undo a notification already sent.
async function logEmail(row: Record<string, unknown>) {
  try {
    await sb("/rest/v1/email_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  } catch (_) { /* ignored on purpose */ }
}

// A directions link that opens the Maps app on both phones, rather than a web
// page you then have to tap through. Works with the address as typed — no
// geocoding, no API key, no bill.
const mapsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { staffId, jobId, title, body, address, url, accessToken } = await req.json().catch(() => ({}));
    if (!staffId) return json({ error: "Nobody to notify." }, 400);
    if (!title && !body) return json({ error: "Nothing to say." }, 400);

    const token = accessToken || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    // AUTHZ against the CALLER's own token, never anything the browser claims.
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_approved_staff`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    if ((chk.ok ? await chk.json() : false) !== true) return json({ error: "Not authorised." }, 403);

    const who = (await (await sb(`/rest/v1/staff?id=eq.${staffId}&select=id,name,email`)).json())[0];
    if (!who) return json({ error: "That person isn't on the staff list." }, 404);

    const link = url || (jobId ? `/jobs/${jobId}` : "/dashboard");
    const directions = address ? mapsUrl(address) : null;

    // ---------------------------------------------------------------- push
    let pushed = 0;
    const pushErrors: string[] = [];
    let devices = 0;

    if (VAPID_PUBLIC && VAPID_PRIVATE) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      const subs = await (await sb(`/rest/v1/push_subscriptions?staff_id=eq.${staffId}&select=*`)).json();
      devices = Array.isArray(subs) ? subs.length : 0;

      for (const s of Array.isArray(subs) ? subs : []) {
        const payload = JSON.stringify({
          title: title || "Pick-up",
          body: body || "",
          url: link,
          mapsUrl: directions,
          tag: jobId ? `job-${jobId}` : undefined,
          requireInteraction: true,
        });
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          pushed++;
          await sb(`/rest/v1/push_subscriptions?id=eq.${s.id}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ last_ok_at: new Date().toISOString(), last_error: null }),
          });
        } catch (e) {
          const status = (e as { statusCode?: number })?.statusCode;
          // 404/410 is the push service saying this device is gone for good —
          // uninstalled, browser data cleared, new phone. Keeping it would mean
          // failing forever against a dead endpoint.
          if (status === 404 || status === 410) {
            await sb(`/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
            pushErrors.push(`${who.name}: a device was unsubscribed and has been removed.`);
          } else {
            pushErrors.push(`${who.name}: push failed (${status ?? "no status"}).`);
            await sb(`/rest/v1/push_subscriptions?id=eq.${s.id}`, {
              method: "PATCH", headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ last_error: String((e as Error)?.message ?? e).slice(0, 500) }),
            });
          }
        }
      }
    }

    // --------------------------------------------------------------- email
    let emailed = false;
    let emailError: string | null = null;
    const to = String(who.email ?? "").trim();
    const subject = title || "Pick-up";

    if (!RESEND) {
      emailError = "RESEND_API_KEY isn't set.";
    } else if (!to) {
      emailError = `${who.name} has no email address on the Staff page.`;
    } else {
      const html =
        `<p>${esc(body || "").replace(/\n/g, "<br/>")}</p>` +
        // No address means no directions link. Say so rather than simply
        // omitting the button: a missing button is indistinguishable from a
        // button that failed to render, and the driver is the one who finds
        // out, in a yard, later.
        (directions
          ? `<p><a href="${directions}">Open in Google Maps</a></p>`
          : `<p><em>No pick-up address was given, so there is no map link. Add one on the job card or the customer's record.</em></p>`) +
        `<p><a href="${APP_URL}${esc(link)}">Open the job card</a></p>`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Betterservice ATV <admin@betterservice.co.nz>", to: [to], subject, html }),
      });
      const rb = await r.json().catch(() => ({} as Record<string, string>));
      emailed = r.ok;
      if (!r.ok) emailError = rb?.message || "Resend rejected the send.";
      await logEmail({
        kind: "pickup_dispatch", subject, to_email: to,
        resend_id: rb?.id ?? null,
        status: r.ok ? "accepted" : "failed",
        error: r.ok ? null : String(emailError).slice(0, 2000),
      });
    }

    // Reported honestly rather than as a single "sent". The page tells whoever
    // pressed the button exactly which half landed, because "it says sent" is
    // what caused this whole line of work in the first place.
    return json({
      ok: pushed > 0 || emailed,
      name: who.name,
      devices, pushed, pushErrors,
      emailed, emailTo: emailed ? to : null, emailError,
      // Whether a directions link was actually attached. Reported rather than
      // inferred, so the page never has to guess what went out.
      mapped: !!directions,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
