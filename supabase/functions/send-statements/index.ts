// send-statements: on a schedule, email each customer a combined statement PDF of what they owe.
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

async function buildStatementPdf(shop: Record<string, string>, g: Record<string, unknown>): Promise<string> {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const draw = (t: string, x: number, size = 10, f = font) => page.drawText(String(t ?? ""), { x, y, size, font: f });
  draw(shop?.business_name || "Betterservice Tepuke", 40, 18, bold); y -= 22;
  if (shop?.address) { draw(shop.address, 40, 9); y -= 12; }
  if (shop?.phone) { draw(shop.phone, 40, 9); y -= 12; }
  if (shop?.gst_number) { draw("GST: " + shop.gst_number, 40, 9); y -= 12; }
  y -= 8;
  draw("STATEMENT", 40, 14, bold);
  page.drawText("As at " + new Date().toLocaleDateString("en-NZ"), { x: 420, y, size: 10, font });
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
  return await pdf.saveAsBase64();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden — set CRON_SECRET and pass it as the x-cron-secret header." }, 403);
  }
  try {
    const shop = (await (await sb("/rest/v1/shop_settings?id=eq.1&select=*")).json())[0] || {};
    const groups = await (await sb("/rest/v1/rpc/outstanding_statements", { method: "POST", body: "{}" })).json();
    if (!Array.isArray(groups) || groups.length === 0) return json({ ok: true, sent: 0, note: "Nothing outstanding." });
    if (!RESEND) return json({ ok: false, sent: 0, error: "RESEND_API_KEY not set — statements not sent.", customers: groups.length });

    let sent = 0;
    const errors: string[] = [];
    for (const g of groups) {
      if (!g.email) continue;
      const pdf64 = await buildStatementPdf(shop, g);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Betterservice Tepuke <accounts@betterservice.co.nz>",
          to: [g.email],
          subject: "Your account statement — Betterservice Tepuke",
          html: `<p>Hi ${g.customer_name || "there"},</p>` +
            `<p>A quick statement of your account with Betterservice Tepuke: <strong>${money(Number(g.total_owing))}</strong> is currently outstanding across ${g.invoices.length} invoice(s). The full breakdown is attached as a PDF.</p>` +
            `<p>Please arrange payment when you can, or reply to this email with any questions.</p>` +
            `<p>Cheers,<br/>Betterservice Tepuke</p>`,
          attachments: [{ filename: "Statement.pdf", content: pdf64 }],
        }),
      });
      if (r.ok) sent++; else errors.push(await r.text());
    }
    return json({ ok: true, sent, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
