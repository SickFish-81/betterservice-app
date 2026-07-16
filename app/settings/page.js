"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const area = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <input value={value || ""} onChange={onChange} placeholder={placeholder} className={input} />
    </label>
  );
}

function Template({ title, hint, subject, body, onSubject, onBody }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">Subject</span>
        <input value={subject || ""} onChange={onSubject} className={input} />
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500">Message</span>
        <textarea value={body || ""} onChange={onBody} rows={7} className={area} />
      </label>
      <p className="mt-1 text-xs text-zinc-400">Placeholders you can use: {hint}</p>
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("shop_settings").select("*").eq("id", 1).single();
    if (error) setError(error.message);
    else setS(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function set(field, val) { setS((prev) => ({ ...prev, [field]: val })); setSaved(false); }

  async function save(e) {
    e.preventDefault();
    setError(null); setSaved(false);
    const { error } = await supabase.from("shop_settings").update({
      business_name: s.business_name, address: s.address, phone: s.phone,
      gst_number: s.gst_number, bank_account: s.bank_account,
      invoice_email_subject: s.invoice_email_subject, invoice_email_body: s.invoice_email_body,
      reminder_email_subject: s.reminder_email_subject, reminder_email_body: s.reminder_email_body,
      po_email_subject: s.po_email_subject, po_email_body: s.po_email_body,
      sms_due_body: s.sms_due_body, reminders_per_day: s.reminders_per_day,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) { setError("Couldn't save — only owners can edit shop settings."); return; }
    setSaved(true);
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Shop Settings</h1>
      <p className="mt-1 text-zinc-600">Your business details (these print on invoice PDFs) and the emails sent to customers and suppliers. Owners can edit.</p>

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : !s ? (
        <p className="mt-6 text-sm text-red-600">{error || "Couldn't load settings."}</p>
      ) : (
        <form onSubmit={save} className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <Field label="Business name" value={s.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Betterservice Te Puke" />
          <Field label="Address" value={s.address} onChange={(e) => set("address", e.target.value)} placeholder="556 Te Puke Highway, Te Puke" />
          <Field label="Phone" value={s.phone} onChange={(e) => set("phone", e.target.value)} placeholder="021 08327787" />
          <Field label="GST number" value={s.gst_number} onChange={(e) => set("gst_number", e.target.value)} placeholder="e.g. 123-456-789" />
          <Field label="Bank account (for invoice payment)" value={s.bank_account} onChange={(e) => set("bank_account", e.target.value)} placeholder="e.g. 12-3456-7890123-00" />

          <div className="border-t border-zinc-100 pt-4">
            <h2 className="text-lg font-semibold text-zinc-900">Message templates</h2>
            <p className="mt-1 text-sm text-zinc-500">
              The emails your customers and suppliers receive. Edit the wording freely — just keep the tags in
              {" "}{"{ }"} braces (like {"{customer}"}); they fill in automatically when the email is sent.
            </p>
            <div className="mt-3 flex flex-col gap-4">
              <Template
                title="Invoice email" hint="{customer} · {number} · {total} · {business} · {phone}"
                subject={s.invoice_email_subject} body={s.invoice_email_body}
                onSubject={(e) => set("invoice_email_subject", e.target.value)} onBody={(e) => set("invoice_email_body", e.target.value)}
              />
              <Template
                title="Service reminder email" hint="{customer} · {machine} · {business} · {phone}"
                subject={s.reminder_email_subject} body={s.reminder_email_body}
                onSubject={(e) => set("reminder_email_subject", e.target.value)} onBody={(e) => set("reminder_email_body", e.target.value)}
              />
              <Template
                title="Purchase order email" hint="{supplier} · {number} · {business} · {phone}"
                subject={s.po_email_subject} body={s.po_email_body}
                onSubject={(e) => set("po_email_subject", e.target.value)} onBody={(e) => set("po_email_body", e.target.value)}
              />
            </div>
          </div>

          <div className="border-t border-zinc-100 pt-4">
            <h2 className="text-lg font-semibold text-zinc-900">Automatic service reminders</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Each day the app texts the most-overdue customers (12–18 months since their last service) a reminder — a few at a time, so replies don't all land at once. Keep the tags in {" "}{"{ }"} braces; they fill in when the text sends.
            </p>
            <label className="mt-3 flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">How many to text per day</span>
              <input type="number" min="0" max="50" value={s.reminders_per_day ?? 5} onChange={(e) => set("reminders_per_day", e.target.value === "" ? "" : Number(e.target.value))} className={input} />
            </label>
            <div className="mt-3 rounded-lg border border-zinc-200 p-3">
              <p className="text-sm font-semibold text-zinc-800">Reminder text</p>
              <label className="mt-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-500">Message</span>
                <textarea value={s.sms_due_body || ""} onChange={(e) => set("sms_due_body", e.target.value)} rows={3} className={area} />
              </label>
              <p className="mt-1 text-xs text-zinc-400">Placeholders you can use: {"{customer} · {machine} · {business} · {phone}"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" className={btn}>Save settings</button>
            {saved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}
    </main>
  );
}
