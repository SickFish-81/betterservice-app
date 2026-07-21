"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";
const saveBtn = "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700";
const cancelBtn = "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50";

// Starter suggestions for the make / model pickers. Edit these freely — the
// lists also grow automatically from the machines you enter.
const SEED_MAKES = ["Honda", "Yamaha", "Suzuki", "Kawasaki", "Polaris", "Can-Am", "CFMoto", "TGB", "KTM", "Husqvarna", "Kymco", "SYM"];
const SEED_MODELS = [
  // Honda ATV
  "TRX250", "TRX250TM", "TRX250TE", "TRX420FM", "TRX420FM1", "TRX420FE", "TRX420FA",
  "TRX500FM", "TRX500FM1", "TRX500FM2", "TRX500FA", "TRX500FE", "TRX520FM", "TRX520FM1", "TRX520FA", "TRX680FA",
  // Honda SxS + ag bikes
  "Pioneer 500", "Pioneer 520", "Pioneer 700", "Pioneer 1000", "Big Red MUV700",
  "CT110", "CTX200 Ag", "CRF150F", "CRF230F", "CRF250F", "XR150L", "XR190", "CG125",
  // Yamaha
  "Grizzly 350", "Grizzly 450", "Grizzly 700", "Kodiak 450", "Kodiak 700", "Big Bear 350",
  "Viking", "Wolverine", "Rhino", "AG100", "AG125", "AG200", "TT-R125", "TT-R230", "TW200",
  // Suzuki
  "KingQuad 400", "KingQuad 500", "KingQuad 750", "Ozark 250", "Eiger 400", "DR200 Trojan", "TF125 Mudbug", "DR-Z125",
  // Kawasaki
  "Brute Force 300", "Brute Force 750", "KVF300", "KVF750", "Bayou 250", "Mule", "Teryx",
  // Polaris
  "Sportsman 450", "Sportsman 570", "Sportsman 850", "Ranger 570", "Ranger 1000", "RZR",
  // Can-Am
  "Outlander 450", "Outlander 570", "Outlander 650", "Outlander 1000", "Defender", "Maverick",
  // CFMoto
  "CForce 400", "CForce 520", "CForce 625", "CForce 850", "UForce 600", "UForce 1000",
];

export default function MachinesPage() {
  const [machines, setMachines] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState("ATV");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [keyNo, setKeyNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [ev, setEv] = useState({ customer_id: "", type: "ATV", make: "", model: "", vin: "", key_number: "" });

  // Per-model parts history (lazy-loaded from parts_for_model()).
  const [openParts, setOpenParts] = useState({});     // machine id -> open?
  const [modelParts, setModelParts] = useState({});   // "make||model" -> rows
  const [partsLoading, setPartsLoading] = useState({}); // key -> loading?

  async function loadData() {
    setLoading(true);
    const { data: m, error: mErr } = await supabase.from("machines").select("*, customers(name)").order("created_at", { ascending: false });
    const { data: c } = await supabase.from("customers").select("id, name").order("name");
    if (mErr) setError(mErr.message);
    else setMachines(m);
    setCustomers(c || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function addMachine(e) {
    e.preventDefault();
    if (!customerId) { setError("Pick a customer first."); return; }
    const { error } = await supabase.from("machines").insert({ customer_id: customerId, type, make, model, vin: vin || null, key_number: keyNo || null });
    if (error) { setError(error.message); return; }
    setMake(""); setModel(""); setVin(""); setKeyNo(""); loadData();
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEv({ customer_id: m.customer_id || "", type: m.type || "ATV", make: m.make || "", model: m.model || "", vin: m.vin || "", key_number: m.key_number || "" });
    setError(null);
  }

  async function saveEdit(id) {
    if (!ev.customer_id) { setError("A machine needs an owner."); return; }
    const { error } = await supabase.from("machines").update({ customer_id: ev.customer_id, type: ev.type, make: ev.make, model: ev.model, vin: ev.vin || null, key_number: ev.key_number || null }).eq("id", id);
    if (error) { setError(error.message); return; }
    setEditingId(null); loadData();
  }

  async function removeMachine(m) {
    if (!window.confirm(`Remove ${m.type} ${m.make} ${m.model}? This can't be undone.`)) return;
    const { error } = await supabase.from("machines").delete().eq("id", m.id);
    if (error) { setError("Couldn't remove that machine — it's still linked to job cards. Remove those jobs first."); return; }
    loadData();
  }

  const modelKey = (m) => `${(m.make || "").toLowerCase()}||${(m.model || "").toLowerCase()}`;
  async function toggleParts(m) {
    const isOpen = openParts[m.id];
    setOpenParts((o) => ({ ...o, [m.id]: !isOpen }));
    if (isOpen) return;
    const key = modelKey(m);
    if (modelParts[key]) return; // already loaded
    setPartsLoading((l) => ({ ...l, [key]: true }));
    const { data } = await supabase.rpc("parts_for_model", { p_make: m.make, p_model: m.model });
    setModelParts((mp) => ({ ...mp, [key]: data || [] }));
    setPartsLoading((l) => ({ ...l, [key]: false }));
  }

  const term = q.trim().toLowerCase();
  const shown = term
    ? machines.filter((m) => (m.type + " " + (m.make || "") + " " + (m.model || "") + " " + (m.vin || "") + " " + (m.key_number || "") + " " + (m.customers?.name || "")).toLowerCase().includes(term))
    : machines;

  const makeOptions = [...new Set([...SEED_MAKES, ...machines.map((m) => m.make).filter(Boolean)])].sort();
  const modelOptions = [...new Set([...SEED_MODELS, ...machines.map((m) => m.model).filter(Boolean)])].sort();
  const idLine = (m) => [m.vin && "VIN " + m.vin, m.key_number && "Key " + m.key_number, m.customers?.name].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Machines</h1>
      <p className="mt-1 text-zinc-600">Bikes &amp; ATVs — identified by make/model (VIN or key number optional) — each linked to a customer.</p>

      <form onSubmit={addMachine} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={input}>
          <option value="">Select customer…</option>
          {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
          <option>ATV</option>
          <option>Motorcycle</option>
          <option>Other</option>
        </select>
        <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make (pick or type new)" list="make-options" className={input} />
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model (pick or type new)" list="model-options" className={input} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input value={vin} onChange={(e) => setVin(e.target.value)} placeholder="VIN (if any)" className={input} />
          <input value={keyNo} onChange={(e) => setKeyNo(e.target.value)} placeholder="Key number (if any)" className={input} />
        </div>
        <button type="submit" className={btn}>Add machine</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search machines by make, model, VIN, key or owner…" className={input} />
        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : machines.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No machines yet. Add one above.</p>
        ) : shown.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No machines match "{q}".</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {shown.map((m) => (
              <li key={m.id} className="p-4">
                {editingId === m.id ? (
                  <div className="flex flex-col gap-2">
                    <select value={ev.customer_id} onChange={(e) => setEv({ ...ev, customer_id: e.target.value })} className={input}>
                      <option value="">Select customer…</option>
                      {customers.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                    </select>
                    <select value={ev.type} onChange={(e) => setEv({ ...ev, type: e.target.value })} className={input}>
                      <option>ATV</option>
                      <option>Motorcycle</option>
                      <option>Other</option>
                    </select>
                    <input value={ev.make} onChange={(e) => setEv({ ...ev, make: e.target.value })} placeholder="Make" list="make-options" className={input} />
                    <input value={ev.model} onChange={(e) => setEv({ ...ev, model: e.target.value })} placeholder="Model" list="model-options" className={input} />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input value={ev.vin} onChange={(e) => setEv({ ...ev, vin: e.target.value })} placeholder="VIN" className={input} />
                      <input value={ev.key_number} onChange={(e) => setEv({ ...ev, key_number: e.target.value })} placeholder="Key number" className={input} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(m.id)} className={saveBtn}>Save</button>
                      <button onClick={() => setEditingId(null)} className={cancelBtn}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-900">{m.type} — {m.make} {m.model}</p>
                        <p className="truncate text-sm text-zinc-500">{idLine(m) || "—"}</p>
                      </div>
                      <div className="flex shrink-0 gap-3 text-sm">
                        <button onClick={() => startEdit(m)} className="font-medium text-red-600 hover:text-red-700">edit</button>
                        <button onClick={() => removeMachine(m)} className="text-zinc-500 hover:text-red-600">remove</button>
                      </div>
                    </div>
                    {(m.make || m.model) && (
                      <div className="mt-2">
                        <button onClick={() => toggleParts(m)} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">
                          {openParts[m.id] ? "▾" : "▸"} Parts used on {m.make} {m.model}
                        </button>
                        {openParts[m.id] && (
                          <div className="mt-2 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                            {partsLoading[modelKey(m)] ? (
                              <p className="text-xs text-zinc-500">Loading…</p>
                            ) : (modelParts[modelKey(m)] || []).length === 0 ? (
                              <p className="text-xs text-zinc-500">No parts recorded yet for this make/model — they'll appear here as parts get added to jobs.</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-xs text-zinc-500">
                                    <th className="pb-1 font-medium">Part</th>
                                    <th className="pb-1 font-medium">Supplier</th>
                                    <th className="pb-1 text-right font-medium">Times</th>
                                    <th className="pb-1 text-right font-medium">Qty</th>
                                    <th className="pb-1 text-right font-medium">Last used</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(modelParts[modelKey(m)] || []).map((p, i) => (
                                    <tr key={i} className="border-t border-zinc-200/70 align-top">
                                      <td className="py-1 pr-2 text-zinc-800">{p.description || "—"}</td>
                                      <td className="py-1 pr-2 text-zinc-600">
                                        {p.supplier ? (
                                          <>
                                            <span>{p.supplier}</span>
                                            {p.supplier_phone && (
                                              <a href={`tel:${String(p.supplier_phone).replace(/\s+/g, "")}`} className="block text-xs text-red-600 hover:underline">{p.supplier_phone}</a>
                                            )}
                                          </>
                                        ) : (
                                          <span className="text-zinc-400">—</span>
                                        )}
                                      </td>
                                      <td className="py-1 text-right tabular-nums text-zinc-600">{p.times_used}</td>
                                      <td className="py-1 text-right tabular-nums text-zinc-600">{Number(p.total_qty)}</td>
                                      <td className="py-1 text-right text-zinc-500">{p.last_used ? new Date(p.last_used).toLocaleDateString("en-NZ") : "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <datalist id="make-options">{makeOptions.map((x) => (<option key={x} value={x} />))}</datalist>
      <datalist id="model-options">{modelOptions.map((x) => (<option key={x} value={x} />))}</datalist>
    </main>
  );
}
