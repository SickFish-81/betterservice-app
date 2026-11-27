// send-payment-reminder: email one customer a reminder for their overdue
// invoices, with the filed invoice PDFs attached, and record it.
//
// Ben, 27 Nov 2026: remind on invoices 14+ days past due, one email per
// customer listing every such invoice, sent by Craig pressing a button on the
// Overdue page. Migration 0096 has the list (overdue_invoices) and the record
// (invoice_reminders).
//
// Two ways in:
//   * BY HAND: an owner on the Overdue page, one customer per call. A customer
//     reminded in the last 6 days is refused.
//   * AUTOMATIC (Ben, 27 Nov: "auto send every 14 days"): a daily pg_cron job
//     calls with the x-reminder-secret header (PAYMENT_REMINDER_SECRET, which
//     the cron job reads from Vault so it never sits in the job's text). Every
//     customer with something 14+ days overdue gets a reminder, then another
//     each 14 days until it's paid.
//
// The rules this function enforces, whatever the page shows:
//   * only an owner who can send invoices may call it (current_staff_can_send);
//   * the invoices are re-worked out here from the database, so the page can't
//     ask for a reminder on something that isn't overdue or isn't theirs;
//   * internal accounts (customers.no_payment_reminders) are never emailed;
//   * nobody is chased twice in a week by hand, or more often than every 14
//     days automatically;
//   * a reminder is RECORDED only if Resend accepted the email. Every attempt,
//     sent or failed, goes in email_log.

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
const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nzDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
const invNo = (n: unknown) => String(n ?? "").padStart(5, "0");

export const DEFAULT_SUBJECT = "Payment reminder — {business}";
export const DEFAULT_BODY =
  "Hi {customer},\n\n" +
  "Just a friendly reminder that the following from {business} is now overdue:\n\n" +
  "{list}\n\n" +
  "Total owing: {total}\n\n" +
  "You can pay by internet banking to {bank}, using the invoice number as the reference. Copies of the invoices are attached.\n\n" +
  "If you've already paid, thank you, and please ignore this. Any questions, just reply to this email or call Craig on {phone}.\n\n" +
  "Cheers,\n{business}";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const MIN_DAYS = 14;
const QUIET_DAYS_MANUAL = 6;
// Automatic: every 14 days. 13.5 so a daily job running at the same time each
// morning lands on day 14 rather than day 15.
const QUIET_DAYS_AUTO = 13.5;
const REMINDER_SECRET = Deno.env.get("PAYMENT_REMINDER_SECRET") || "";

async function svc(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
async function logEmail(row: Record<string, unknown>) {
  try {
    await svc("/rest/v1/email_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  } catch (_) { /* best effort */ }
}
function userIdFromToken(t: string): string | null {
  try {
    const p = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p?.sub ?? null;
  } catch { return null; }
}
function toB64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

type Row = {
  invoice_id: string; invoice_number: number; issued_date: string; due_date: string; days_overdue: number;
  balance: number; customer_id: string | null; customer_name: string | null; customer_email: string | null;
  last_reminded_at: string | null; excluded: boolean;
};

async function loadSettings() {
  const sres = await svc("/rest/v1/shop_settings?id=eq.1&select=*");
  return (sres.ok ? (await sres.json())[0] : null) || {};
}

// Email one customer about all their rows, attach the PDFs, log it, record it.
// deno-lint-ignore no-explicit-any
async function remind(customerId: string, rows: Row[], actor: string | null, st: any) {
  const first = rows[0];
  const to = first.customer_email!;
  const business = st.business_name || "Betterservice ATV";
  const bccRaw = String(st.invoice_bcc ?? "").trim();
  const bcc = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bccRaw) ? bccRaw : "";
  const total = rows.reduce((s, r) => s + Number(r.balance), 0);
  const list = rows
    .map((r) => `Invoice #${invNo(r.invoice_number)}, dated ${nzDate(r.issued_date)}, due ${nzDate(r.due_date)}: ${money(Number(r.balance))}`)
    .join("\n");
  const vars = {
    customer: (first.customer_name || "there").split(",")[0].trim(),
    business, phone: st.phone || "021 0832 7787",
    bank: st.bank_account || "our bank account (details on the invoice)",
    list, total: money(total), count: rows.length,
  };
  const subject = applyTemplate(st.overdue_email_subject || DEFAULT_SUBJECT, vars);
  const html = toHtml(applyTemplate(st.overdue_email_body || DEFAULT_BODY, vars));

  // The filed PDFs. A missing one doesn't stop the reminder; it just isn't attached.
  const ids = rows.map((r) => r.invoice_id);
  const pr = await svc(`/rest/v1/invoices?id=in.(${ids.join(",")})&select=id,invoice_number,pdf_url`);
  const pdfRows = pr.ok ? ((await pr.json()) as { id: string; invoice_number: number; pdf_url: string | null }[]) : [];
  const attachments: { filename: string; content: string }[] = [];
  const missing: number[] = [];
  for (const p of pdfRows) {
    if (!p.pdf_url) { missing.push(p.invoice_number); continue; }
    const f = await svc(`/storage/v1/object/invoices/${p.pdf_url}`, { headers: { "Content-Type": "application/octet-stream" } });
    if (!f.ok) { missing.push(p.invoice_number); continue; }
    attachments.push({ filename: `Invoice-${invNo(p.invoice_number)}.pdf`, content: toB64(await f.arrayBuffer()) });
  }

  let emailId: string | null = null;
  let emailError: string | null = null;
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) emailError = "RESEND_API_KEY is not set.";
  else {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${business} <accounts@betterservice.co.nz>`,
        to: [to],
        ...(bcc ? { bcc: [bcc] } : {}),
        subject, html,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    const data = await r.json().catch(() => ({} as Record<string, string>));
    if (!r.ok) emailError = data?.message || "Resend rejected the send.";
    else emailId = data.id ?? null;
  }

  await logEmail({
    kind: "payment_reminder", subject, to_email: to, bcc_email: emailId ? (bcc || null) : null,
    invoice_id: rows.length === 1 ? rows[0].invoice_id : null, customer_id: customerId,
    sent_by: actor, resend_id: emailId, status: emailId ? "accepted" : "failed",
    error: emailError ? String(emailError).slice(0, 2000) : null,
  });

  let recorded = false;
  if (emailId) {
    const ins = await svc("/rest/v1/invoice_reminders", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(rows.map((r) => ({ invoice_id: r.invoice_id, customer_id: customerId, sent_by: actor, to_email: to, resend_id: emailId }))),
    });
    recorded = ins.ok;
  }
  return { emailed: !!emailId, emailError, recorded, to, invoices: rows.map((r) => r.invoice_number), total, attached: attachments.length, missingPdfs: missing };
}

async function overdueRows(): Promise<Row[] | null> {
  const lr = await svc("/rest/v1/rpc/overdue_invoices", { method: "POST", body: JSON.stringify({ p_min_days: MIN_DAYS }) });
  return lr.ok ? ((await lr.json()) as Row[]) : null;
}
const remindedWithin = (rows: Row[], days: number) => {
  const since = Date.now() - days * 86400000;
  return rows.find((r) => r.last_reminded_at && new Date(r.last_reminded_at).getTime() > since);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // ---------------------------------------------------------- AUTOMATIC
    const cronHeader = req.headers.get("x-reminder-secret");
    if (cronHeader !== null) {
      if (!REMINDER_SECRET || cronHeader !== REMINDER_SECRET) return json({ error: "Forbidden." }, 403);
      const all = await overdueRows();
      if (!all) return json({ error: "Couldn't read overdue invoices." }, 500);
      const by: Record<string, Row[]> = {};
      for (const r of all) if (r.customer_id) (by[r.customer_id] = by[r.customer_id] || []).push(r);
      const st = await loadSettings();
      const sent: unknown[] = [];
      const skipped: unknown[] = [];
      for (const [cid, rows] of Object.entries(by)) {
        const name = rows[0].customer_name;
        if (rows[0].excluded) { skipped.push({ name, why: "internal" }); continue; }
        if (!rows[0].customer_email) { skipped.push({ name, why: "no email" }); continue; }
        if (remindedWithin(rows, QUIET_DAYS_AUTO)) { skipped.push({ name, why: "reminded in the last 14 days" }); continue; }
        sent.push({ name, ...(await remind(cid, rows, null, st)) });
      }
      return json({ ok: true, sent, skipped });
    }

    // ------------------------------------------------------------ BY HAND
    const body = await req.json().catch(() => ({}));
    const { customerId, accessToken } = body as { customerId?: string; accessToken?: string };
    if (!customerId) return json({ error: "No customer given." }, 400);

    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const token = accessToken || (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in." }, 401);
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/rpc/current_staff_can_send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const canSend = chk.ok ? await chk.json() : false;
    if (canSend !== true) return json({ error: "Not authorised — only an owner who can send invoices can do this." }, 403);
    const actor = userIdFromToken(token);

    // The list, worked out here, not taken from the page.
    const all = await overdueRows();
    if (!all) return json({ error: "Couldn't read overdue invoices." }, 500);
    const rows = all.filter((r) => r.customer_id === customerId);
    if (!rows.length) return json({ error: "Nothing of theirs is 14 or more days overdue." }, 400);
    if (rows[0].excluded) return json({ error: "This account is set to never get payment reminders." }, 400);
    if (!rows[0].customer_email) return json({ error: "No email on file for this customer." }, 400);
    const recent = remindedWithin(rows, QUIET_DAYS_MANUAL);
    if (recent) return json({ error: `Already reminded on ${new Date(recent.last_reminded_at!).toLocaleDateString("en-NZ")}. Wait a week before chasing again.` }, 409);

    const out = await remind(customerId, rows, actor, await loadSettings());
    return json({ ok: out.emailed, ...out }, out.emailed ? 200 : 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
