// generate-rental-invoices: bill the storage units and the shed, automatically.
//
// Runs DAILY, not monthly, and that is deliberate. Rent is issued three days
// before the period it covers (29 Aug for 1 Sep), and a once-a-month job that
// fails is a month of rent never invoiced — you'd find out from the bank, not
// the app. Running daily inside a +/- 3 day window around each period start
// means a bad day heals itself the next morning, and the unique index on
// (agreement, period) makes double-billing impossible however often it fires.
//
// Money is never computed here. generate_rental_invoice() does it in the
// database from the agreement, the same way generate_invoice() does for job
// cards, and returns null when an agreement isn't billable for that period
// (not started, ended, on hold, or already invoiced).
//
// Call with ?dry=1 to see exactly what it would send, without sending anything.
//
// Needs: SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, RESEND_API_KEY.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND = Deno.env.get("RESEND_API_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const money = (n: unknown) => "$" + Number(n || 0).toFixed(2);
const invNo = (n: unknown) => "#" + String(n).padStart(5, "0");
const nzDate = (d: unknown) => (d ? new Date(String(d) + "T00:00:00Z").toLocaleDateString("en-NZ", { timeZone: "UTC" }) : "");

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
async function sb(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
function b64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// The periods worth considering today: the month ahead, and the current month.
// A +/- 3 day window around each start gives roughly six chances to get a month
// out, without ever reaching back and billing a month that is already over.
function periodsInPlay(today: Date): string[] {
  const y = today.getUTCFullYear(), m = today.getUTCMonth();
  const candidates = [new Date(Date.UTC(y, m + 1, 1)), new Date(Date.UTC(y, m, 1))];
  const out: string[] = [];
  for (const p of candidates) {
    const days = (p.getTime() - Date.UTC(y, m, today.getUTCDate())) / 86400000;
    if (days <= 3 && days >= -3) out.push(p.toISOString().slice(0, 10));
  }
  return out;
}

function applyTemplate(tpl: unknown, vars: Record<string, unknown>) {
  return String(tpl ?? "").replace(/\{(\w+)\}/g, (_m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k] ?? "") : `{${k}}`);
}

// Craig's welcome-and-conditions letter, rendered from the editable template in
// Settings. pdf-lib neither wraps nor paginates, so both are done here.
async function buildLetterPdf(body: string) {
  const { PDFDocument, StandardFonts } = await import("https://esm.sh/pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const SIZE = 11, LEAD = 15, LEFT = 50, TOP = 790, BOTTOM = 60, WIDTH = 495;

  const lines: string[] = [];
  for (const para of String(body ?? "").split(/\r?\n/)) {
    if (!para.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of para.trim().split(/\s+/)) {
      const test = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(test, SIZE) > WIDTH && line) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }

  let page = pdf.addPage([595, 842]);
  let y = TOP;
  for (const ln of lines) {
    if (y < BOTTOM) { page = pdf.addPage([595, 842]); y = TOP; }
    if (ln) page.drawText(ln, { x: LEFT, y, size: SIZE, font });
    y -= LEAD;
  }
  return await pdf.saveAsBase64();
}

async function buildInvoicePdf(shop: Record<string, string>, inv: Record<string, unknown>, customer: Record<string, string>, lines: Record<string, unknown>[]) {
  const { PDFDocument, StandardFonts } = await import("https://esm.sh/pdf-lib@1.17.1");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 800;
  const draw = (t: unknown, x: number, size = 10, f = font) => page.drawText(String(t ?? ""), { x, y, size, font: f });

  draw(shop?.business_name || "Betterservice ATV", 40, 18, bold); y -= 22;
  if (shop?.address) { draw(shop.address, 40, 9); y -= 12; }
  if (shop?.phone) { draw(shop.phone, 40, 9); y -= 12; }
  if (shop?.gst_number) { draw("GST: " + shop.gst_number, 40, 9); y -= 12; }
  y -= 10;

  draw("TAX INVOICE " + invNo(inv.invoice_number), 40, 14, bold);
  page.drawText("Issued " + nzDate(inv.issued_date), { x: 400, y, size: 10, font });
  y -= 16;
  page.drawText("Due " + nzDate(inv.due_date), { x: 400, y, size: 10, font });
  y -= 20;

  // Addressed to whoever pays. A unit let to a business is invoiced to the
  // business, with the person as the contact — same rule as job card invoices.
  const billedTo = String(customer?.company_name ?? "").trim();
  if (billedTo) {
    draw("To: " + billedTo, 40, 11, bold); y -= 13;
    draw("Attn: " + (customer?.name || ""), 40, 9); y -= 12;
  } else {
    draw("To: " + (customer?.name || ""), 40, 11, bold); y -= 14;
  }
  if (customer?.address) { draw(customer.address, 40, 9); y -= 12; }
  y -= 10;

  draw("Description", 40, 10, bold); draw("Amount", 470, 10, bold);
  y -= 4; page.drawLine({ start: { x: 40, y }, end: { x: 540, y }, thickness: 0.5 }); y -= 14;
  for (const l of lines) {
    draw(l.description, 40); draw(money(l.amount), 470);
    y -= 15;
  }
  y -= 4; page.drawLine({ start: { x: 40, y }, end: { x: 540, y }, thickness: 0.5 }); y -= 16;

  draw("Subtotal", 380); draw(money(inv.subtotal), 470); y -= 14;
  draw("GST 15%", 380); draw(money(inv.gst), 470); y -= 16;
  draw("Total", 380, 12, bold); draw(money(inv.total), 470, 12, bold); y -= 26;

  draw("Rent is collected by automatic payment on the due date.", 40, 9); y -= 12;
  if (shop?.bank_account) { draw("Bank account: " + shop.bank_account, 40, 10); y -= 14; }
  draw("Thank you.", 40, 10);
  return await pdf.saveAsBase64();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden — set CRON_SECRET and pass it as the x-cron-secret header." }, 403);
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";

  try {
    const periods = periodsInPlay(new Date());
    if (periods.length === 0) return json({ ok: true, note: "Not near a period start — nothing to do.", generated: 0 });

    const shop = (await (await sb("/rest/v1/shop_settings?id=eq.1&select=*")).json())[0] || {};
    const business = shop.business_name || "Betterservice ATV";

    const agreements = await (await sb(
      "/rest/v1/rental_agreements?select=id,on_hold,start_date,end_date,monthly_rate_incl_gst,lease_pdf_path,lease_sent_at,customers(name,email,address,company_name),rental_units(name)"
    )).json();
    if (!Array.isArray(agreements)) return json({ error: "Couldn't read agreements", detail: agreements }, 500);

    const done: Record<string, unknown>[] = [];
    const problems: string[] = [];

    for (const period of periods) {
      for (const ag of agreements) {
        const who = `${ag.rental_units?.name || "unit"} / ${ag.customers?.name || "tenant"}`;

        if (dry) {
          const skip = ag.on_hold ? "on hold"
            : ag.start_date > period ? "not started"
            : (ag.end_date && ag.end_date < period) ? "ended"
            : null;
          done.push({ period, who, would: skip ? `skip (${skip})` : `invoice ${money(ag.monthly_rate_incl_gst)}`, email: ag.customers?.email || null });
          continue;
        }

        // The database decides whether this is billable, and computes the money.
        const r = await sb("/rest/v1/rpc/generate_rental_invoice", {
          method: "POST",
          body: JSON.stringify({ p_agreement_id: ag.id, p_period_start: period }),
        });
        if (!r.ok) { problems.push(`${who}: ${await r.text()}`); continue; }
        const inv = await r.json();
        if (!inv || !inv.id) continue; // not billable, or already invoiced

        const lines = await (await sb(`/rest/v1/invoice_line_items?invoice_id=eq.${inv.id}&select=description,amount`)).json();
        const pdf64 = await buildInvoicePdf(shop, inv, ag.customers || {}, Array.isArray(lines) ? lines : []);

        // File the shop's copy.
        const path = `invoices/${period.slice(0, 7)}/rent-${inv.invoice_number}-${Date.now()}.pdf`;
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/invoices/${path}`, {
          method: "POST",
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/pdf" },
          body: Uint8Array.from(atob(pdf64), (c) => c.charCodeAt(0)),
        });
        const filed = up.ok ? path : null;
        if (!up.ok) problems.push(`${who}: PDF not filed (${up.status})`);

        // The lease goes out once, with the first invoice for that agreement.
        // A file uploaded against the agreement wins — that's the signed or
        // lawyer-drafted version. Otherwise it's rendered from the Settings
        // template, so Craig can reword it without a deploy.
        const attachments: Record<string, string>[] = [{ filename: `Invoice-${String(inv.invoice_number).padStart(5, "0")}.pdf`, content: pdf64 }];
        let leaseSent = false;
        if (!ag.lease_sent_at) {
          if (ag.lease_pdf_path) {
            const lr = await fetch(`${SUPABASE_URL}/storage/v1/object/${ag.lease_pdf_path}`, {
              headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
            });
            if (lr.ok) {
              attachments.push({ filename: "Lease-Agreement.pdf", content: b64(new Uint8Array(await lr.arrayBuffer())) });
              leaseSent = true;
            } else {
              problems.push(`${who}: lease attachment couldn't be read (${lr.status})`);
            }
          } else if (shop.lease_letter_body) {
            const letter = applyTemplate(shop.lease_letter_body, {
              customer: ag.customers?.name || "",
              unit: ag.rental_units?.name || "",
              date: nzDate(inv.issued_date),
              start: nzDate(ag.start_date),
            });
            attachments.push({ filename: "Lease-Agreement.pdf", content: await buildLetterPdf(letter) });
            leaseSent = true;
          }
        }

        let emailed = false;
        const to = ag.customers?.email;
        if (to && RESEND) {
          const monthName = new Date(period + "T00:00:00Z").toLocaleDateString("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" });
          const er = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${business} <admin@betterservice.co.nz>`,
              to: [to],
              subject: `Rent invoice ${invNo(inv.invoice_number)} — ${monthName}`,
              html:
                `<p>Hi ${esc(ag.customers?.name || "there")},</p>` +
                `<p>Your rent invoice for <strong>${esc(ag.rental_units?.name)}</strong> covering ${esc(monthName)} is attached — <strong>${money(inv.total)}</strong>, due ${nzDate(inv.due_date)}.</p>` +
                (leaseSent ? `<p>Your lease agreement is attached as well, for your records.</p>` : "") +
                `<p>This is collected by automatic payment, so there's nothing to do — the invoice is for your records.</p>` +
                `<p>Cheers,<br/>${esc(business)}</p>`,
              attachments,
            }),
          });
          emailed = er.ok;
          if (!er.ok) problems.push(`${who}: email rejected — ${await er.text()}`);
        } else if (!to) {
          problems.push(`${who}: no email address on file — invoice created but not sent`);
        } else if (!RESEND) {
          problems.push(`${who}: RESEND_API_KEY not set — invoice created but not sent`);
        }

        await sb(`/rest/v1/invoices?id=eq.${inv.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sent: emailed, sent_at: emailed ? new Date().toISOString() : null, ...(filed ? { pdf_url: filed } : {}) }),
        });
        if (leaseSent && emailed) {
          await sb(`/rest/v1/rental_agreements?id=eq.${ag.id}`, {
            method: "PATCH", body: JSON.stringify({ lease_sent_at: new Date().toISOString() }),
          });
        }

        done.push({ period, who, invoice: invNo(inv.invoice_number), total: money(inv.total), emailed, lease: leaseSent });
      }
    }

    // Tell the shop what went out. With auto-send this summary is the only
    // safety net there is — a wrong invoice should be a same-day fix, not a
    // month-end surprise.
    const bcc = String(shop.invoice_bcc ?? "").trim();
    if (!dry && done.length > 0 && RESEND && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(bcc)) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${business} <admin@betterservice.co.nz>`,
          to: [bcc],
          subject: `Rent invoices sent — ${done.length} invoice(s)`,
          html:
            `<p>The rent run has just gone out:</p><ul>` +
            done.map((d) => `<li>${esc(d.who)} — ${esc(d.invoice)} ${esc(d.total)}${d.emailed ? "" : " <strong>(not emailed)</strong>"}${d.lease ? " + lease" : ""}</li>`).join("") +
            `</ul>` +
            (problems.length ? `<p><strong>Needs a look:</strong></p><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "<p>No problems.</p>"),
        }),
      });
    }

    return json({ ok: true, dry, periods, generated: done.length, done, problems });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
