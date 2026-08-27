// create-staff-login: create the Supabase Auth account for someone already on the
// staff list, so an owner can do it from the Staff page instead of the dashboard.
//
// Why this exists: staff access is matched on `staff.email` = the signed-in email.
// Creating those two halves separately is how Craig ended up with a staff row and
// no login — he could not open the app at all, with no error explaining why.
//
// SAFETY RULES, in order of importance:
//   1. Owners only. Checked server-side against is_owner() using the CALLER's token,
//      never trusting anything the browser claims.
//   2. The email must already exist on the staff list. This function cannot mint an
//      arbitrary account — it can only complete one an owner already created. So even
//      if the authz check were somehow bypassed, the blast radius is bounded.
//   3. The service key never leaves the server. It is read from the environment here
//      and is never returned, logged, or sent to the browser.
//   4. Never touches an existing account. If the address already has a login it
//      reports that and stops, so this can't be used to reset someone's password.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// A readable temp password the owner can pass on verbally, then have them change.
function tempPassword() {
  const words = ["Kauri", "Tui", "Rimu", "Weka", "Totara", "Kea", "Matai", "Piwaka"];
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const word = words[bytes[0] % words.length];
  const digits = String(bytes[1] * 256 + bytes[2]).padStart(5, "0").slice(0, 5);
  return `${word}-${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { email, accessToken } = await req.json().catch(() => ({}));

    const address = String(email ?? "").trim().toLowerCase();
    if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      return json({ error: "That doesn't look like an email address." }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const SERVICE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")["default"] ||
      "";
    if (!SERVICE_KEY) return json({ error: "Server is missing its admin key." }, 500);

    const token = accessToken || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);

    // RULE 1 — owners only, verified against the caller's own token.
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_owner`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const isOwner = chk.ok ? await chk.json() : false;
    if (isOwner !== true) return json({ error: "Owners only." }, 403);

    // RULE 2 — the address must already be on the active staff list.
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?select=id,name,email,active&email=ilike.${encodeURIComponent(address)}`,
      { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } },
    );
    const rows = staffRes.ok ? await staffRes.json() : [];
    const member = Array.isArray(rows) ? rows.find((r) => (r.email || "").toLowerCase() === address) : null;
    if (!member) {
      return json({ error: "No staff member has that email. Add them to the staff list first." }, 400);
    }
    if (member.active === false) {
      return json({ error: `${member.name} is marked inactive. Set them active before creating a login.` }, 400);
    }

    const admin = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" };

    // RULE 4 — never touch an account that already exists.
    const existing = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(address)}`,
      { headers: admin },
    );
    if (existing.ok) {
      const found = await existing.json();
      const users = found?.users ?? found ?? [];
      if (Array.isArray(users) && users.some((u: { email?: string }) => (u.email || "").toLowerCase() === address)) {
        return json({ error: `${member.name} already has a login. Reset the password in Supabase if they're locked out.` }, 409);
      }
    }

    const password = tempPassword();
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      // email_confirm skips the confirmation email — this project doesn't send auth mail,
      // so without it the account would be created but unable to sign in.
      body: JSON.stringify({ email: address, password, email_confirm: true }),
    });
    if (!created.ok) {
      return json({ error: `Couldn't create the login (${created.status}): ${await created.text()}` }, 400);
    }

    // The password is returned ONCE, to the owner who asked for it. It is never stored.
    return json({ ok: true, name: member.name, email: address, password });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
