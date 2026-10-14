// create-staff-login: create — or reset — the Supabase Auth account for someone
// already on the staff list, so an owner can do it from the Staff page instead
// of the Supabase dashboard.
//
// Why this exists: creating a staff row and a login separately is how Craig
// ended up with a staff row and no login — he could not open the app at all,
// with no error explaining why.
//
// Why RESET was added: the shop's staff logins use addresses that are not real
// mailboxes (ants@, bjorn@, peni@ exist only as sign-in names). A password reset
// email can never arrive at those, so "forgot password" is useless for them and
// was removed from the login page. Without a reset here, every forgotten staff
// password meant hand-writing SQL against auth.users.
//
// 14 Oct 2026 — WHY THIS TAKES A STAFF ID AND NOT AN EMAIL.
// This used to find the staff member with `email=ilike.<the address the browser
// sent>`. That made `staff.email` the identity, and `staff.email` is also just
// the mailbox we send dispatch to — which we clear, deliberately, when an
// address hard-bounces, so dispatch stops eroding sending reputation for every
// Betterservice email. Clearing it therefore locked the person out AND broke
// this, the one tool that could have let an owner fix it. Peni: he could sign
// in, the app said "Awaiting approval", and this function answered "No staff
// member has that email."
//
// So the staff member is now identified by their row id, and the sign-in
// address is read from the DATABASE — their mailbox if they have one, otherwise
// the address on the auth account their row is linked to. The browser no longer
// gets to say who anyone is, which makes rule 2 below a stronger boundary than
// it was, not a weaker one.
//
// SAFETY RULES, in order of importance:
//   1. Owners only. Checked server-side against is_owner() using the CALLER's
//      token, never trusting anything the browser claims.
//   2. The staff row must exist and be active. This function cannot mint an
//      arbitrary account — it can only complete or repair one for someone an
//      owner already put on the staff list, at an address that comes from the
//      database. Even if the authz check were bypassed, the blast radius is
//      bounded to people already on the staff list.
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
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type StaffRow = { id: string; name: string; email: string | null; active: boolean | null; role: string | null; user_id: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { staffId, email, accessToken, password: chosen, mode } = body as {
      staffId?: string; email?: string; accessToken?: string; password?: string; mode?: string;
    };
    const action = mode === "reset" ? "reset" : "create";

    // `email` is still accepted so an older browser tab that hasn't reloaded
    // keeps working through a deploy. It only ever selects WHICH staff row —
    // never what address gets used. Drop it once the page has been live a while.
    const sid = typeof staffId === "string" ? staffId.trim() : "";
    const lookupEmail = String(email ?? "").trim().toLowerCase();
    if (!sid && !lookupEmail) return json({ error: "Which staff member? None was named." }, 400);

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

    const admin = { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json" };

    // RULE 2 — the staff row must exist and be active. Read with the CALLER's
    // token, so this cannot see further than the owner asking can.
    const cols = "select=id,name,email,active,role,user_id";
    const where = sid
      ? `id=eq.${encodeURIComponent(sid)}`
      : `email=ilike.${encodeURIComponent(lookupEmail)}`;
    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/staff?${cols}&${where}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    const rows: StaffRow[] = staffRes.ok ? await staffRes.json() : [];
    const member = Array.isArray(rows)
      ? (sid ? rows[0] : rows.find((r) => (r.email || "").toLowerCase() === lookupEmail))
      : null;
    if (!member) {
      return json({ error: "That staff member isn't on the list. Add them first." }, 400);
    }
    if (member.active === false) {
      return json({ error: `${member.name} is marked inactive. Set them active before changing their login.` }, 400);
    }

    // The sign-in address, taken from the database and never from the request:
    // their mailbox if they have one, otherwise whatever the auth account their
    // row is linked to actually signs in with. The second case is the whole
    // point — it is how someone whose bouncing mailbox we cleared can still
    // have their password set.
    let address = (member.email || "").trim().toLowerCase();
    let existingId: string | null = member.user_id;
    if (existingId) {
      const who = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existingId}`, { headers: admin });
      if (who.ok) {
        const u = await who.json();
        const linked = String(u?.email ?? "").trim().toLowerCase();
        if (linked) address = linked;   // the live sign-in name wins over a stale mailbox
      } else {
        // The row points at an account that no longer exists. Treat it as having
        // no login rather than reporting a confusing 404 further down.
        existingId = null;
      }
    }

    // No link yet? Then the only address we are willing to use is the one on the
    // staff row, and an owner has to put it there first.
    if (!address) {
      return json({
        error: `${member.name} has no sign-in address. Add their email on the staff list first, then create their login.`,
      }, 400);
    }
    if (!EMAIL_RE.test(address)) {
      return json({ error: `${member.name}'s email address (${address}) doesn't look valid. Fix it on the staff list first.` }, 400);
    }

    // RULE 4 — an owner's password is their own business.
    if (member.role === "owner" && address !== callerEmail) {
      return json({
        error: `${member.name} is an owner, so only they can change their own password. Owners use a real email address, so a reset can be sent from the Supabase dashboard instead.`,
      }, 403);
    }

    // Not linked by user_id? Fall back to finding the account by address, for a
    // staff row created before logins were linked.
    if (!existingId) {
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
    }

    // Keep staff.user_id pointing at the login, so nothing has to go back to
    // matching on an address. This is what stops the whole class of problem
    // coming back the next time a mailbox is cleared.
    async function link(userId: string) {
      await fetch(`${SUPABASE_URL}/rest/v1/staff?id=eq.${encodeURIComponent(member!.id)}`, {
        method: "PATCH",
        headers: { ...admin, Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId }),
      }).catch(() => { /* non-fatal: the password change still happened */ });
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
      if (!member.user_id) await link(existingId);
      return json({ ok: true, action: "reset", name: member.name, email: address, password: typed });
    }

    // --------------------------------------------------------------- create
    if (existingId) {
      if (!member.user_id) await link(existingId);   // it existed, just unlinked
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
    const newUser = await created.json().catch(() => null);
    if (newUser?.id) await link(newUser.id);
    return json({ ok: true, action: "create", name: member.name, email: address, password });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
