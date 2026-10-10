// send-statements: on a schedule, email each customer a combined statement PDF of what they owe.
//
// Every statement is now written to email_log, sent or failed, so the monthly
// run leaves a record instead of a number in a response nobody reads.
//
// Note on scope: outstanding_statements() joins job_cards, so this covers ATV
// work only. Rent invoices never appear on a statement — that is presumably
// deliberate, since rent is invoiced on its own cycle, but it is worth knowing
// before anyone treats a statement as the whole picture of a customer's
// account.
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND = Deno.env.get("RESEND_API_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const money = (n: number) => "$" + Number(n || 0).toFixed(2);
const invNo = (n: number) => "#" + String(n).padStart(5, "0");
const nzDate = (d: string) => new Date(d).toLocaleDateString("en-NZ");

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
async function sb(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
// Best effort. A logging failure must never stop the run or undo a sent email.
async function logEmail(row: Record<string, unknown>) {
  try {
    await sb("/rest/v1/email_log", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  } catch (_) { /* ignored on purpose */ }
}

// The fourteen built-in PDF fonts are encoded in WinAnsi, which has no macron
// vowels, and pdf-lib throws rather than guess — so a single customer named
// "Ngāti ..." would fail the whole statement run, not just their page. A real
// Unicode font is fetched instead; pdf-lib subsets it, so only the glyphs
// actually used are embedded. See lib/FONTS.md.
//
// Deliberately duplicated in generate-rental-invoices and send-rental-invoice
// rather than shared: each edge function deploys on its own.
const FONT_URLS = {
  regular: "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf",
  bold: "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf",
};
let FONT_BYTES: { regular: Uint8Array; bold: Uint8Array } | false | null = null;
async function unicodeFontBytes() {
  if (FONT_BYTES !== null) return FONT_BYTES;
  try {
    const [r, b] = await Promise.all([fetch(FONT_URLS.regular), fetch(FONT_URLS.bold)]);
    if (!r.ok || !b.ok) throw new Error(`${r.status}/${b.status}`);
    FONT_BYTES = { regular: new Uint8Array(await r.arrayBuffer()), bold: new Uint8Array(await b.arrayBuffer()) };
  } catch (_e) {
    FONT_BYTES = false; // a statement with flattened names beats no statement
  }
  return FONT_BYTES;
}

// Latin-1 accents survive; anything past it keeps its letter and loses the mark.
function winAnsiSafe(t: unknown) {
  return String(t ?? "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\xFF]/g, (ch) => ch.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

async function buildStatementPdf(shop: Record<string, string>, g: Record<string, unknown>): Promise<string> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]);

  // Assigned in one expression each, so the compiler can see that a font is
  // always present: an "is it undefined?" at every drawText call would be a
  // worse bug than the one being fixed.
  const bytes = await unicodeFontBytes();
  let pair: { regular: Awaited<ReturnType<typeof pdf.embedFont>>; bold: Awaited<ReturnType<typeof pdf.embedFont>> } | null = null;
  if (bytes) {
    try {
      // esm.sh hands fontkit back as a default export at runtime, but its type
      // declaration says namespace, so take whichever is actually there.
      const mod = await import("https://esm.sh/@pdf-lib/fontkit@1.1.1") as { default?: unknown };
      pdf.registerFontkit((mod.default ?? mod) as Parameters<typeof pdf.registerFontkit>[0]);
      pair = {
        regular: await pdf.embedFont(bytes.regular, { subset: true }),
        bold: await pdf.embedFont(bytes.bold, { subset: true }),
      };
    } catch (_e) { pair = null; /* fall through to the built-ins */ }
  }
  const unicode = pair !== null;
  const font = pair ? pair.regular : await pdf.embedFont(StandardFonts.Helvetica);
  const bold = pair ? pair.bold : await pdf.embedFont(StandardFonts.HelveticaBold);
  // Every string reaching the page goes through here, so there is one place to
  // be right rather than one per drawText call.
  const txt = (t: unknown) => (unicode ? String(t ?? "") : winAnsiSafe(t));

  let y = 800;
  const draw = (t: string, x: number, size = 10, f = font) => page.drawText(txt(t), { x, y, size, font: f });
  draw(shop?.business_name || "Betterservice ATV", 40, 18, bold); y -= 22;
  if (shop?.address) { draw(shop.address, 40, 9); y -= 12; }
  if (shop?.phone) { draw(shop.phone, 40, 9); y -= 12; }
  if (shop?.gst_number) { draw("GST: " + shop.gst_number, 40, 9); y -= 12; }
  y -= 8;
  draw("STATEMENT", 40, 14, bold);
  page.drawText(txt("As at " + new Date().toLocaleDateString("en-NZ")), { x: 420, y, size: 10, font });
  y -= 22;
  draw("To: " + (g.customer_name || ""), 40, 11, bold); y -= 20;
  draw("Invoice", 40, 10, bold); draw("Date", 140, 10, bold); draw("Total", 300, 10, bold); draw("Paid", 380, 10, bold); draw("Owing", 470, 10, bold);
  y -= 4; page.drawLine({ start: { x: 40, y }, end: { x: 540, y }, thickness: 0.5 }); y -= 14;
  for (const iv of (g.invoices as Record<string, number>[])) {
    draw(invNo(iv.number), 40); draw(nzDate(String(iv.date)), 140); draw(money(iv.total), 300); draw(money(iv.paid), 380); draw(money(iv.balance), 470);
    y -= 15;
    if (y < 90) { page = pdf.addPage([595, 842]); y = 800; }
  }
  y -= 4; page.drawLine({ start: { x: 40, y }, end: { x: 540, y }, thickness: 0.5 }); y -= 16;
  draw("Total owing", 380, 12, bold); draw(money(Number(g.total_owing)), 470, 12, bold); y -= 26;
  if (shop?.bank_account) { draw("Please pay to: " + shop.bank_account, 40, 10); y -= 14; }
  draw("Thank you for your business.", 40, 10);

  // Shop strapline at the foot of every page, matching the invoice.
  // Through txt() like everything else: ASCII today, but the invariant that
  // nothing reaches the page unsanitised should not depend on reading this
  // literal and checking. widthOfTextAtSize throws on the same characters
  // drawText does, so both must see the one safe string.
  const tagline = txt("Betterservice = Better Price = Better Advice = Better Bikes");
  for (const pg of pdf.getPages()) {
    const w = font.widthOfTextAtSize(tagline, 9);
    pg.drawText(tagline, { x: (595 - w) / 2, y: 40, size: 9, font });
  }
  return await pdf.saveAsBase64();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden — set CRON_SECRET and pass it as the x-cron-secret header." }, 403);
  }
  try {
    const shop = (await (await sb("/rest/v1/shop_settings?id=eq.1&select=*")).json())[0] || {};
    const business = shop.business_name || "Betterservice ATV";
    const groups = await (await sb("/rest/v1/rpc/outstanding_statements", { method: "POST", body: "{}" })).json();
    if (!Array.isArray(groups) || groups.length === 0) return json({ ok: true, sent: 0, note: "Nothing outstanding." });
    if (!RESEND) return json({ ok: false, sent: 0, error: "RESEND_API_KEY not set — statements not sent.", customers: groups.length });

    // outstanding_statements() returns names and addresses but no customer id,
    // so the log rows would have nothing to join on. One small lookup up front
    // maps address -> id for the whole run, rather than a request per customer.
    const byEmail = new Map<string, string>();
    try {
      const cres = await sb("/rest/v1/customers?select=id,email&email=not.is.null");
      if (cres.ok) {
        for (const c of (await cres.json()) as { id: string; email: string }[]) {
          if (c.email) byEmail.set(String(c.email).trim().toLowerCase(), c.id);
        }
      }
    } catch (_) { /* the log row simply goes without a customer_id */ }

    let sent = 0;
    const errors: string[] = [];
    for (const g of groups) {
      if (!g.email) continue;
      const to = String(g.email).trim();
      const subject = `Your account statement — ${business}`;
      const customerId = byEmail.get(to.toLowerCase()) ?? null;

      const pdf64 = await buildStatementPdf(shop, g);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // Name comes from Settings, so renaming the business never needs a redeploy.
          from: `${business} <admin@betterservice.co.nz>`,
          to: [to],
          subject,
          html: `<p>Hi ${g.customer_name || "there"},</p>` +
            `<p>A quick statement of your account with ${business}: <strong>${money(Number(g.total_owing))}</strong> is currently outstanding across ${g.invoices.length} invoice(s). The full breakdown is attached as a PDF.</p>` +
            `<p>Please arrange payment when you can, or reply to this email with any questions.</p>` +
            `<p>Cheers,<br/>${business}</p>`,
          attachments: [{ filename: "Statement.pdf", content: pdf64 }],
        }),
      });
      const rBody = await r.json().catch(() => ({} as Record<string, string>));

      if (r.ok) {
        sent++;
        await logEmail({
          kind: "statement", subject, to_email: to,
          customer_id: customerId, resend_id: rBody?.id ?? null, status: "accepted",
        });
      } else {
        const msg = rBody?.message || "Resend rejected the send.";
        errors.push(`${g.customer_name} <${to}>: ${msg}`);
        await logEmail({
          kind: "statement", subject, to_email: to,
          customer_id: customerId, status: "failed", error: String(msg).slice(0, 2000),
        });
      }
    }
    return json({ ok: true, sent, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
