// create-staff-login: create — or reset — the Supabase Auth account for someone
// already on the staff list, so an owner can do it from the Staff page instead
// of the Supabase dashboard.
//
// Why this exists: staff access is matched on `staff.email` = the signed-in
// email. Creating those two halves separately is how Craig ended up with a staff
// row and no login — he could not open the app at all, with no error explaining
// why.
//
// Why RESET was added: the shop's staff logins use addresses that are not real
// mailboxes (ants@, bjorn@ exist only as sign-in names). A password reset email
// can never arrive at those, so "forgot password" is useless for them and was
// removed from the login page. Without a reset here, every forgotten staff
// password meant hand-writing SQL against auth.users. Now Craig can just set one.
//
// SAFETY RULES, in order of importance:
//   1. Owners only. Checked server-side against is_owner() using the CALLER's
//      token, never trusting anything the browser claims.
//   2. The email must already be on the active staff list. This function cannot
//      mint an arbitrary account — it can only complete or repair one an owner
//      already created. Even if the authz check were bypassed, the blast radius
//      is bounded to people already on the staff list.
//   3. The service key never leaves the server. Read from the environment here,
//      never returned, logged, or sent to the browser.
//   4. An owner's password can only be changed by that owner. Craig can set any
//      mechanic's password, but not another owner's, and vice versa. This is not
//      arbitrary: owners have real mailboxes and can recover by email from the
//      Supabase dashboard; staff have fake ones and genuinely need this. It also
//      means no single owner account can be used to take over another.
//   5. Passwords are returned ONCE to the owner who asked, and never stored,
//      logged, or written to the database.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// A readable temp password the owner can pass on verbally, used when they don't
// type one of their own.
function tempPassword() {
  const words = ["Kauri", "Tui", "Rimu", "Weka", "Totara", "Kea", "Matai", "Piwaka"];
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const word = words[bytes[0] % words.length];
  const digits = String(bytes[1] * 256 + bytes[2]).padStart(5, "0").slice(0, 5);
  return `${word}-${digits}`;
}

const MIN_PASSWORD = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { email, accessToken, password: chosen, mode } = body as {
      email?: string; accessToken?: string; password?: string; mode?: string;
    };
    const action = mode === "reset" ? "reset" : "create";

    const address = String(email ?? "").trim().toLowerCase();
    if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      return json({ error: "That doesn't look like an email address." }, 400);
    }

    // A typed password is optional on create, required on reset (there is no
    // sense in resetting someone to a password nobody asked for).
    const typed = typeof chosen === "string" ? chosen.trim() : "";
    if (typed && typed.length < MIN_PASSWORD) {
      return json({ error: `Password must be at least ${MIN_PASSWORD} characters.` }, 400);
    }
    if (action === "reset" && !typed) {
      return json({ error: "Type the new password first." }, 400);
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

    // Who is asking? Needed for rule 4.
    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    const me = meRes.ok ? await meRes.json() : null;
    const callerEmail = String(me?.email ?? "").trim().toLowerCase();

    // RULE 2 — the address must already be on the active staff list.
    const staffRes = await fetch(
      `${SUPABASE_URL}/rest/v1/staff?select=id,name,email,active,role&email=ilike.${encodeURIComponent(address)}`,
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

    // RULE 4 — an owner's password is their own business.
    if (member.role === "owner" && address !== callerEmail) {
      return json({
        error: `${member.name} is an owner, so only they can change their own password. Owners use a real email address, so a reset can be sent from the Supabase dashboard instead.`,
      }, 403);
    }

    const admin = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" };

    // Does an auth account already exist for this address?
    let existingId: string | null = null;
    const existing = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(address)}`,
      { headers: admin },
    );
    if (existing.ok) {
      const found = await existing.json();
      const users = found?.users ?? found ?? [];
      if (Array.isArray(users)) {
        const hit = users.find((u: { email?: string; id?: string }) => (u.email || "").toLowerCase() === address);
        existingId = hit?.id ?? null;
      }
    }

    // ---------------------------------------------------------------- reset
    if (action === "reset") {
      if (!existingId) {
        return json({ error: `${member.name} has no login yet. Create one first.` }, 404);
      }
      const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existingId}`, {
        method: "PUT",
        headers: admin,
        body: JSON.stringify({ password: typed }),
      });
      if (!upd.ok) {
        return json({ error: `Couldn't set the password (${upd.status}): ${await upd.text()}` }, 400);
      }
      return json({ ok: true, action: "reset", name: member.name, email: address, password: typed });
    }

    // --------------------------------------------------------------- create
    if (existingId) {
      return json({ error: `${member.name} already has a login. Use "set password" instead.` }, 409);
    }
    const password = typed || tempPassword();
    const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      // email_confirm skips the confirmation email — this project doesn't send
      // auth mail, and most staff addresses are not real mailboxes anyway, so
      // without it the account would exist but never be able to sign in.
      body: JSON.stringify({ email: address, password, email_confirm: true }),
    });
    if (!created.ok) {
      return json({ error: `Couldn't create the login (${created.status}): ${await created.text()}` }, 400);
    }
    return json({ ok: true, action: "create", name: member.name, email: address, password });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
