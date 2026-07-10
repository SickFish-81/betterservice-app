// Supabase Edge Function: send-reminder
// Emails a service-due reminder to a customer via Resend.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { to, customerName, machineLabel } = await req.json().catch(() => ({}));
    if (!to) return json({ error: "No email on file for this customer." }, 400);
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY is not set." }, 500);

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Betterservice Tepuke <accounts@betterservice.co.nz>",
        to: [to],
        subject: "Time for a service — Betterservice Tepuke",
        html:
          `<p>Hi ${customerName || "there"},</p>` +
          `<p>It's Craig at Betterservice Tepuke. Our records show your <strong>${machineLabel || "bike"}</strong> is about due for its service — it's been roughly a year since the last one.</p>` +
          `<p>A regular service keeps it running sweet, safe and reliable. Give me a call or text on <strong>021 08327787</strong> to book it in.</p>` +
          `<p>Cheers,<br/>Craig · Betterservice Tepuke</p>`,
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.message || "Resend rejected the send." }, 400);
    return json({ ok: true, emailId: data.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
