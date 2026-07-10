"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700">{label}</span>
      <input value={value || ""} onChange={onChange} placeholder={placeholder} className={input} />
    </label>
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
      gst_number: s.gst_number, bank_account: s.bank_account, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) { setError("Couldn't save — only owners can edit shop settings."); return; }
    setSaved(true);
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Shop settings</h1>
      <p className="mt-1 text-zinc-600">Your business details — these print on every invoice PDF. Owners can edit.</p>

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : !s ? (
        <p className="mt-6 text-sm text-red-600">{error || "Couldn't load settings."}</p>
      ) : (
        <form onSubmit={save} className="mt-6 flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <Field label="Business name" value={s.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Betterservice Tepuke" />
          <Field label="Address" value={s.address} onChange={(e) => set("address", e.target.value)} placeholder="556 Te Puke Highway, Te Puke" />
          <Field label="Phone" value={s.phone} onChange={(e) => set("phone", e.target.value)} placeholder="021 08327787" />
          <Field label="GST number" value={s.gst_number} onChange={(e) => set("gst_number", e.target.value)} placeholder="e.g. 123-456-789" />
          <Field label="Bank account (for invoice payment)" value={s.bank_account} onChange={(e) => set("bank_account", e.target.value)} placeholder="e.g. 12-3456-7890123-00" />
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
