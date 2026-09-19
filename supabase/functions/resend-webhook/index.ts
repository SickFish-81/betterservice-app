// resend-webhook — Resend tells us what happened to an email after we sent it.
//
// HOW THIS FILE GOT HERE, AND THE RULE IT EXISTS TO ENFORCE:
// this function was deployed on 9 Sep 2026 and ran in production for ten days
// with NO copy in this repo at all. It is the code that writes delivery status
// into email_log, so anyone reading the repo to work out how "delivered" gets
// set was reading a repo that did not contain the answer. The body below is
// production version 4, pulled down verbatim on 19 Sep 2026 — not a rewrite,
// not a reconstruction.
//
// This is at least the FIFTH drift of this shape by the project's own count,
// and the sixth counting the July migration reconciliation — the commit that
// added this file said "the fourth" and was wrong; see DECISIONS.md. The rule,
// same as it has been every time: SUPABASE IS LIVE. If you change a function or the
// schema in the dashboard, bring it back into this repo in the same sitting,
// or the next person debugging at 7am works from a file that is a polite
// fiction.
//
// WHAT IT DOES:
// - Verifies the Svix signature before believing a single byte. Unsigned, badly
//   signed or replayed-from-days-ago requests are rejected.
// - Maps Resend's event types onto email_log.status, and refuses to let a
//   late-arriving "sent" overwrite a "delivered" or "bounced" — webhooks come
//   out of order often enough to matter.
// - An event for an email with no row gets a row rather than being dropped.
// - A failed LOOKUP returns 503 so Resend retries, instead of being mistaken
//   for "no such row" and inserting a duplicate.
//
// verify_jwt is OFF for this function, by necessity — Resend has no Supabase
// token. The signature check IS the authentication. Do not remove it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SIGNING_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
async function sb(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

// Compare without leaking where two strings first differ.
function sameSignature(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body",
// keyed with the base64 part of the whsec_ secret.
async function signatureIsGood(req: Request, raw: string) {
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const header = req.headers.get("svix-signature");
  if (!id || !ts || !header || !SIGNING_SECRET) return false;

  // A replayed request from days ago is not a delivery report.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  const secret = SIGNING_SECRET.startsWith("whsec_") ? SIGNING_SECRET.slice(6) : SIGNING_SECRET;
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // The header can carry several versioned signatures: "v1,aaa v1,bbb".
  for (const part of header.split(" ")) {
    const [version, sig] = part.split(",");
    if (version === "v1" && sig && sameSignature(sig, expected)) return true;
  }
  return false;
}

// Webhooks arrive out of order often enough to matter. Once something has
// definitely landed or definitely failed, an older "sent" must not undo it.
const RANK: Record<string, number> = {
  accepted: 0, sent: 1, delivery_delayed: 2, delivered: 3, bounced: 3, complained: 4, failed: 3,
};
const TERMINAL = new Set(["delivered", "bounced", "complained", "failed"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Read the body as text, once. Re-serialising it would change the bytes and
  // break the signature.
  const raw = await req.text();
  if (!(await signatureIsGood(req, raw))) return json({ error: "Bad signature" }, 401);

  let event: Record<string, any>;
  try { event = JSON.parse(raw); } catch { return json({ error: "Not JSON" }, 400); }

  const type = String(event?.type ?? "");
  const data = event?.data ?? {};
  const resendId = data?.email_id || data?.id;
  const at = event?.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString();

  if (!resendId) return json({ ok: true, ignored: "no email id on event" });

  const patch: Record<string, unknown> = { last_event_at: at };
  let incoming: string | null = null;

  switch (type) {
    case "email.sent":            incoming = "sent"; break;
    case "email.delivered":       incoming = "delivered"; patch.delivered_at = at; break;
    case "email.delivery_delayed": incoming = "delivery_delayed"; break;
    case "email.bounced":
      incoming = "bounced";
      patch.bounced_at = at;
      patch.bounce_reason = data?.bounce?.message || data?.reason || data?.bounce?.subType || null;
      break;
    case "email.complained":      incoming = "complained"; break;
    case "email.opened":          patch.opened_at = at; break; // never changes status
    case "email.clicked":         break;
    default:                      return json({ ok: true, ignored: type });
  }

  const look = await sb(`/rest/v1/email_log?resend_id=eq.${encodeURIComponent(resendId)}&select=id,status`);
  if (!look.ok) {
    // A lookup failure is NOT the same as "no such row". Treating it as one
    // would insert a duplicate and lose the link to the original send, so tell
    // Resend to retry instead.
    return json({ error: "Lookup failed, retry" }, 503);
  }
  const rows = await look.json().catch(() => null);
  const existing = Array.isArray(rows) ? rows[0] : null;

  if (!existing) {
    // An email we have no row for -- sent before this table existed, or from
    // somewhere else on the account. Record it rather than drop it.
    await sb("/rest/v1/email_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        kind: "unknown",
        to_email: Array.isArray(data?.to) ? data.to.join(", ") : String(data?.to ?? "unknown"),
        subject: data?.subject ?? null,
        resend_id: resendId,
        status: incoming ?? "sent",
        ...patch,
      }),
    });
    return json({ ok: true, created: true, type });
  }

  if (incoming) {
    const now = String(existing.status ?? "accepted");
    const keepCurrent = TERMINAL.has(now) && (RANK[incoming] ?? 0) <= (RANK[now] ?? 0);
    if (!keepCurrent) patch.status = incoming;
  }

  await sb(`/rest/v1/email_log?id=eq.${existing.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });

  return json({ ok: true, type, resend_id: resendId });
});
