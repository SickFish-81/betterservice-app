"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [name, setName] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("checklist_templates").select("*").order("created_at");
    if (error) setError(error.message);
    else setTemplates(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addTemplate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const items = itemsText.split("\n").map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase.from("checklist_templates").insert({ name, items });
    if (error) { setError(error.message); return; }
    setName(""); setItemsText(""); load();
  }

  async function removeTemplate(id) {
    if (!window.confirm("Delete this template?")) return;
    await supabase.from("checklist_templates").delete().eq("id", id);
    load();
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Checklist Templates</h1>
      <p className="mt-1 text-zinc-600">Standard task lists (e.g. "Full ATV service") to drop onto a job so nothing gets missed.</p>

      <form onSubmit={addTemplate} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name — e.g. Full ATV service" className={input} />
        <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={6} placeholder={"One task per line, e.g.\nChange engine oil & filter\nCheck & adjust brakes\nClean air filter\nCheck tyre pressures\nTest ride"} className={input} />
        <button type="submit" className={btn}>Save template</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      <div className="mt-6">
        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No templates yet. Add your first one above.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((t) => (
              <li key={t.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-900">{t.name}</span>
                  <button onClick={() => removeTemplate(t.id)} className="text-xs text-red-500 hover:underline">remove</button>
                </div>
                <p className="mt-1 text-sm text-zinc-500">{(t.items || []).length} tasks</p>
                <ul className="mt-2 list-inside list-disc text-sm text-zinc-600">
                  {(t.items || []).map((it, i) => (<li key={i}>{it}</li>))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
