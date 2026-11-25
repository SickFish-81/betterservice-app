"use client";

// Stock — the machines the business owns, from hire to sale (migration 0092).
//
// This replaces Craig's "For sale list" spreadsheet. One row per machine,
// grouped by the stage it's at:
//
//   On hire -> To pick up -> Workshop -> Presale -> For sale -> Sold
//
// Everyone can update a row (Ben, 20 Nov 2026: "everyone can update"), with
// money as the line: only an owner can set a price or put a machine on the
// website, and the database refuses anyone else, whatever this page shows.
// Nothing is deleted from here: a machine leaves stock by being Sold.
//
// Selling (migration 0093, Craig's "Problem" email, 25 Nov 2026): "Mark as
// sold" records the date, the buyer and (owners only) the price in one call,
// sell_stock_item(). That also moves the bike to the buyer and starts its
// 12-month service reminder from the sale date. The key number stays on the bike.
//
// Removing (migration 0094, Craig's "Removing bike" email, 26 Nov 2026): owners
// can take a machine out of stock after an "are you sure" step. The machine
// record goes too if it has never been in the workshop. Sold rows and rows on
// the website can't be removed from here.
//
// Edits save on a button, never on blur (see the draft-invoice fix in
// app/invoices/[id]: autosave was throwing away Craig's edits).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import { useOwner } from "../RoleContext";

const STAGES = ["On hire", "To pick up", "Workshop", "Presale", "For sale", "Parts / wreck", "Sold"];
const STAGE_STYLE = {
  "On hire": "bg-indigo-50 text-indigo-700",
  "To pick up": "bg-amber-50 text-amber-800",
  "Workshop": "bg-orange-50 text-orange-700",
  "Presale": "bg-sky-50 text-sky-700",
  "For sale": "bg-emerald-50 text-emerald-700",
  "Parts / wreck": "bg-zinc-100 text-zinc-700",
  "Sold": "bg-zinc-100 text-zinc-500",
};
const CATEGORIES = ["ATV / 4 Wheeler", "Side by Side", "2 Wheeler", "Other"];
const STOCK_OWNER = "Betterservice sales"; // the customer record new stock machines belong to

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50";
const saveBtn = "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50";
const cancelBtn = "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50";
const money = (n) => (n === null || n === undefined || n === "" ? "" : "$" + Number(n).toLocaleString("en-NZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const nzDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "2-digit" }) : "");
const BLANK_NEW = { type: "ATV", make: "", model: "", year: "", key_number: "", stage: "Workshop", came_in: "", work_done: "", to_do: "", asking_price: "" };
const todayNZ = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }); // YYYY-MM-DD
const plusYear = (d) => { const [y, m, day] = d.split("-"); return `${Number(y) + 1}-${m}-${day}`; };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const BLANK_SALE = { sold_at: "", customer_id: "", cq: "", name: "", phone: "", email: "", address: "", price: "", notes: "" };
const machineTitle = (m) => [m?.make, m?.model, m?.year].filter(Boolean).join(" ") || m?.type || "Machine";

export default function StockPage() {
  const owner = useOwner();
  const [rows, setRows] = useState([]);
  const [machines, setMachines] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [q, setQ] = useState("");
  const [showSold, setShowSold] = useState(false);
  const [editId, setEditId] = useState(null);
  const [ev, setEv] = useState({});
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState(false);
  const [nv, setNv] = useState(BLANK_NEW);
  const [matches, setMatches] = useState(null); // machines already on file with the new key number; null = not checked yet
  const [listFor, setListFor] = useState(null); // stock row id being put on the website
  const [listCat, setListCat] = useState("");
  const [sellId, setSellId] = useState(null); // stock row id being marked sold
  const [sv, setSv] = useState(BLANK_SALE);
  const [removeId, setRemoveId] = useState(null); // stock row waiting on "are you sure"

  async function load() {
    setError(null);
    const { data: st, error: sErr } = await supabase.from("stock_items").select("*").order("came_in", { ascending: false, nullsFirst: false });
    if (sErr) { setError(sErr.message); setLoading(false); return; }
    const mids = (st || []).map((r) => r.machine_id);
    const lids = (st || []).map((r) => r.listing_id).filter(Boolean);
    const [{ data: ms }, { data: cs }, { data: js }, { data: ls }] = await Promise.all([
      mids.length ? supabase.from("machines").select("id, customer_id, type, make, model, year, key_number").in("id", mids) : { data: [] },
      supabase.from("customers").select("id, name, phone, email").order("name"),
      mids.length ? supabase.from("job_cards").select("id, job_number, status, machine_id").in("machine_id", mids).not("status", "in", "(Invoiced,Paid)") : { data: [] },
      lids.length ? supabase.from("secondhand_listings").select("id, status, price").in("id", lids) : { data: [] },
    ]);
    setRows(st || []); setMachines(ms || []); setCustomers(cs || []); setJobs(js || []); setListings(ls || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const byId = (list, id) => list.find((x) => x.id === id);
  const view = useMemo(() => rows.map((r) => ({
    ...r,
    machine: byId(machines, r.machine_id),
    hire: byId(customers, r.hire_customer_id),
    buyer: byId(customers, r.sold_to_customer_id),
    job: jobs.find((j) => j.machine_id === r.machine_id),
    listing: byId(listings, r.listing_id),
  })), [rows, machines, customers, jobs, listings]);

  const shown = view.filter((r) => {
    if (!q.trim()) return true;
    const t = [machineTitle(r.machine), r.machine?.key_number, r.work_done, r.to_do, r.notes, r.hire?.name, r.buyer?.name].join(" ").toLowerCase();
    return t.includes(q.trim().toLowerCase());
  });

  function startEdit(r) {
    setEditId(r.id); setSellId(null); setError(null); setNote(null);
    setEv({
      make: r.machine?.make || "", model: r.machine?.model || "", year: r.machine?.year ? String(r.machine.year) : "", key_number: r.machine?.key_number || "",
      stage: r.stage, came_in: r.came_in || "", ready: r.ready, work_done: r.work_done || "", to_do: r.to_do || "", notes: r.notes || "",
      asking_price: r.asking_price ?? "", hire_customer_id: r.hire_customer_id || "",
      for_sale_at: r.for_sale_at || "", sold_at: r.sold_at || "", sold_price: r.sold_price ?? "",
    });
  }

  async function saveEdit(r) {
    setBusy(r.id); setError(null);
    const year = String(ev.year).trim();
    const { error: mErr } = await supabase.from("machines").update({
      make: ev.make.trim(), model: ev.model.trim(), year: year ? Number(year) : null, key_number: ev.key_number.trim() || null,
    }).eq("id", r.machine_id);
    if (mErr) { setBusy(""); setError("Couldn't save the machine: " + mErr.message); return; }
    const patch = {
      stage: ev.stage, came_in: ev.came_in || null, ready: !!ev.ready, work_done: ev.work_done.trim() || null,
      to_do: ev.to_do.trim() || null, notes: ev.notes.trim() || null,
      hire_customer_id: ["On hire", "To pick up"].includes(ev.stage) ? (ev.hire_customer_id || null) : r.hire_customer_id,
      for_sale_at: ev.for_sale_at || null,
    };
    if (r.stage === "Sold" && ev.stage === "Sold" && ev.sold_at) patch.sold_at = ev.sold_at;
    // Price only goes in the update when it actually changed, so a staff
    // member saving notes doesn't trip the owner-only price rule.
    const price = String(ev.asking_price).trim() === "" ? null : Number(ev.asking_price);
    if (price !== (r.asking_price === null ? null : Number(r.asking_price))) patch.asking_price = price;
    if (owner && r.stage === "Sold") {
      const sp = String(ev.sold_price).trim() === "" ? null : Number(ev.sold_price);
      if (sp !== null && !(sp >= 0)) { setBusy(""); setError("The sale price needs to be a number."); return; }
      if (sp !== (r.sold_price === null ? null : Number(r.sold_price))) patch.sold_price = sp;
    }
    const { error: sErr } = await supabase.from("stock_items").update(patch).eq("id", r.id);
    setBusy("");
    if (sErr) { setError(sErr.message); return; }
    setEditId(null); setNote("Saved."); load();
  }

  async function toggleReady(r) {
    const { error: e } = await supabase.from("stock_items").update({ ready: !r.ready }).eq("id", r.id);
    if (e) { setError(e.message); return; }
    load();
  }

  // Adding a machine checks the key number first. Craig added B79 as a new
  // machine on 24 Nov when it was already on file with job #159 open, so the
  // job and the stock row ended up on two different records.
  async function addMachine(e) {
    e.preventDefault(); setError(null);
    const key = nv.key_number.trim();
    if (key && matches === null) {
      setBusy("add");
      const found = await findByKey(key);
      setBusy("");
      if (found.error) { setError("Couldn't check the key number: " + found.error); return; }
      if (found.list.length) { setMatches(found.list); return; }
    }
    await createNew();
  }

  // Machines with the same key number (any case), with their open job and
  // whether they're already in stock. The stock owner's machines come first.
  async function findByKey(key) {
    const pattern = key.replace(/[\\%_]/g, (c) => "\\" + c);
    const { data: ms, error: e1 } = await supabase.from("machines").select("id, customer_id, type, make, model, year, key_number").ilike("key_number", pattern);
    if (e1) return { error: e1.message };
    if (!ms?.length) return { list: [] };
    const ids = ms.map((m) => m.id);
    const [{ data: js }, { data: st }] = await Promise.all([
      supabase.from("job_cards").select("id, job_number, status, machine_id").in("machine_id", ids).not("status", "in", "(Invoiced,Paid)"),
      supabase.from("stock_items").select("id, stage, machine_id").in("machine_id", ids),
    ]);
    const list = ms.map((m) => ({
      ...m,
      owner: byId(customers, m.customer_id)?.name || "",
      job: (js || []).find((j) => j.machine_id === m.id),
      stock: (st || []).find((x) => x.machine_id === m.id),
    }));
    list.sort((a, b) => (b.owner === STOCK_OWNER) - (a.owner === STOCK_OWNER) || !!b.job - !!a.job);
    return { list };
  }

  async function createNew() {
    setError(null);
    if (!nv.make.trim() || !nv.model.trim()) { setError("Make and model are needed."); return; }
    setBusy("add");
    const { data: ownerRow } = await supabase.from("customers").select("id").eq("name", STOCK_OWNER).maybeSingle();
    const year = nv.year.trim();
    const { data: m, error: mErr } = await supabase.from("machines").insert({
      customer_id: ownerRow?.id || null, type: nv.type.trim() || "ATV", make: nv.make.trim(), model: nv.model.trim(),
      year: year ? Number(year) : null, key_number: nv.key_number.trim() || null,
    }).select("id").single();
    if (mErr) { setBusy(""); setError("Couldn't add the machine: " + mErr.message); return; }
    await insertStock(m.id, "Added.");
  }

  // Use a machine that's already on file. Only blank details are filled in
  // from the form; nothing already on the machine record is overwritten.
  async function pickExisting(m) {
    if (m.stock) { setError(`That machine is already in stock (${m.stock.stage}). Search for ${m.key_number} to find it.`); return; }
    setBusy("add"); setError(null);
    const fill = {};
    if (!m.make && nv.make.trim()) fill.make = nv.make.trim();
    if (!m.model && nv.model.trim()) fill.model = nv.model.trim();
    if (!m.year && nv.year.trim()) fill.year = Number(nv.year.trim());
    if (Object.keys(fill).length) {
      const { error: fErr } = await supabase.from("machines").update(fill).eq("id", m.id);
      if (fErr) { setBusy(""); setError("Couldn't update the machine: " + fErr.message); return; }
    }
    await insertStock(m.id, m.job ? `Added, on the existing machine (job #${m.job.job_number}).` : "Added, on the existing machine.");
  }

  async function insertStock(machineId, done) {
    const row = { machine_id: machineId, stage: nv.stage, came_in: nv.came_in || null, work_done: nv.work_done.trim() || null, to_do: nv.to_do.trim() || null };
    if (owner && String(nv.asking_price).trim()) row.asking_price = Number(nv.asking_price);
    const { error: sErr } = await supabase.from("stock_items").insert(row);
    setBusy("");
    if (sErr) { setError(sErr.message); return; }
    closeAdd();
    setNote(done); load();
  }

  function closeAdd() { setAdding(false); setMatches(null); setNv(BLANK_NEW); }

  function startSell(r) {
    setSellId(r.id); setEditId(null); setError(null); setNote(null);
    setSv({ ...BLANK_SALE, sold_at: todayNZ(), price: owner && r.asking_price !== null ? String(r.asking_price) : "", notes: r.notes || "" });
  }

  async function sellIt(r) {
    setError(null);
    if (!sv.sold_at) { setError("Enter the date it sold."); return; }
    if (!sv.customer_id && !sv.name.trim()) { setError("Enter the buyer's name, or pick them from your customers."); return; }
    const price = owner && String(sv.price).trim() !== "" ? Number(sv.price) : null;
    if (price !== null && !(price >= 0)) { setError("The sale price needs to be a number."); return; }
    setBusy(r.id);
    const { data: cust, error: e } = await supabase.rpc("sell_stock_item", {
      p_stock_id: r.id, p_sold_at: sv.sold_at, p_customer_id: sv.customer_id || null,
      p_name: sv.name, p_phone: sv.phone, p_email: sv.email, p_address: sv.address,
      p_price: price, p_notes: sv.notes,
    });
    setBusy("");
    if (e) { setError(e.message); return; }
    const who = sv.customer_id ? byId(customers, sv.customer_id)?.name : sv.name.trim();
    setSellId(null); setSv(BLANK_SALE);
    setNote(`Sold to ${who || "the buyer"}. The bike is now under their name, with a service reminder due ${nzDate(plusYear(sv.sold_at))}.`);
    if (cust) load();
  }

  async function removeIt(r) {
    setBusy(r.id); setError(null); setNote(null);
    const { data, error: e } = await supabase.rpc("remove_stock_item", { p_stock_id: r.id });
    setBusy(""); setRemoveId(null);
    if (e) { setError(e.message); return; }
    setNote(data === "machine_deleted"
      ? `Removed ${machineTitle(r.machine)} from stock.`
      : `Removed ${machineTitle(r.machine)} from stock. Its machine record stays, because it has workshop history.`);
    load();
  }

  // Owner only: create the public listing from the stock row, with the same
  // price. Photos are added on the For Sale page.
  async function listOnWebsite(r) {
    if (!listCat) { setError("Pick a category so it shows in the right For Sale section."); return; }
    if (r.asking_price === null) { setError("Set a price first."); return; }
    setBusy(r.id); setError(null);
    const { data: l, error: lErr } = await supabase.from("secondhand_listings").insert({
      title: machineTitle(r.machine), description: r.work_done || null, price: Number(r.asking_price), status: "Available", category: listCat,
    }).select("id").single();
    if (lErr) { setBusy(""); setError("Couldn't create the listing: " + lErr.message); return; }
    const { error: sErr } = await supabase.from("stock_items").update({ listing_id: l.id, stage: "For sale" }).eq("id", r.id);
    setBusy("");
    if (sErr) { setError(sErr.message); return; }
    setListFor(null); setListCat(""); setNote("On the website. Add photos on the For Sale page."); load();
  }

  const setS = (k) => (e) => setSv((v) => ({ ...v, [k]: e.target.value }));
  const set = (k) => (e) => setEv((v) => ({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const setN = (k) => (e) => {
    setNv((v) => ({ ...v, [k]: e.target.value }));
    if (k === "key_number") setMatches(null); // a new key number gets checked again
  };

  // A render function, not a component: a component defined inside this one
  // would be a new type on every render, and the edit boxes would lose focus
  // after each keystroke.
  function renderRow(r) {
    const m = r.machine || {};
    if (editId === r.id) {
      return (
        <li key={r.id} className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input value={ev.make} onChange={set("make")} placeholder="Make" className={input} />
            <input value={ev.model} onChange={set("model")} placeholder="Model" className={input} />
            <input value={ev.year} onChange={set("year")} placeholder="Year" inputMode="numeric" className={input} />
            <input value={ev.key_number} onChange={set("key_number")} placeholder="Key number" className={input} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select value={ev.stage} onChange={set("stage")} className={input}>{STAGES.filter((s) => s !== "Sold" || r.stage === "Sold").map((s) => <option key={s}>{s}</option>)}</select>
            <label className="flex flex-col text-xs text-zinc-500">Came in<input type="date" value={ev.came_in} onChange={set("came_in")} className={input} /></label>
            {owner ? (
              <label className="flex flex-col text-xs text-zinc-500">Price incl GST<input value={ev.asking_price} onChange={set("asking_price")} inputMode="decimal" placeholder="e.g. 6999" className={input} /></label>
            ) : (
              <p className="self-end text-sm text-zinc-500">Price: {money(r.asking_price) || "not set"} (owners set prices)</p>
            )}
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-zinc-700"><input type="checkbox" checked={!!ev.ready} onChange={set("ready")} className="h-4 w-4" /> Ready to sell</label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col text-xs text-zinc-500">Up for sale<input type="date" value={ev.for_sale_at} onChange={set("for_sale_at")} className={input} /></label>
            {r.stage === "Sold" && ev.stage === "Sold" && (
              <label className="flex flex-col text-xs text-zinc-500">Date sold<input type="date" value={ev.sold_at} onChange={set("sold_at")} className={input} /></label>
            )}
            {owner && r.stage === "Sold" && ev.stage === "Sold" && (
              <label className="flex flex-col text-xs text-zinc-500">Sold for, incl GST<input value={ev.sold_price} onChange={set("sold_price")} inputMode="decimal" className={input} /></label>
            )}
          </div>
          {r.stage === "Sold" && ev.stage !== "Sold" && (
            <p className="mt-2 text-xs text-amber-800">Taking it out of Sold clears the sale date, but the bike stays under {r.buyer?.name || "the buyer"}&apos;s name. Change the owner on the customer page if the sale fell through.</p>
          )}
          {["On hire", "To pick up"].includes(ev.stage) && (
            <select value={ev.hire_customer_id} onChange={set("hire_customer_id")} className={input + " mt-2"}>
              <option value="">Who has it on hire?</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <textarea value={ev.work_done} onChange={set("work_done")} rows={2} placeholder="Work done (e.g. new clutch, stator, full service)" className={input + " mt-2"} />
          <textarea value={ev.to_do} onChange={set("to_do")} rows={2} placeholder="Still to do (e.g. soft wash, starter motor)" className={input + " mt-2"} />
          <textarea value={ev.notes} onChange={set("notes")} rows={1} placeholder="Other notes" className={input + " mt-2"} />
          <div className="mt-3 flex gap-2">
            <button onClick={() => saveEdit(r)} disabled={busy === r.id} className={saveBtn}>{busy === r.id ? "Saving…" : "Save"}</button>
            <button onClick={() => setEditId(null)} className={cancelBtn}>Cancel</button>
          </div>
        </li>
      );
    }
    if (sellId === r.id) {
      const cq = sv.cq.trim().toLowerCase();
      const found = cq.length >= 2 ? customers.filter((c) => [c.name, c.phone].join(" ").toLowerCase().includes(cq)).slice(0, 8) : [];
      const picked = sv.customer_id ? byId(customers, sv.customer_id) : null;
      return (
        <li key={r.id} className="rounded-xl border border-emerald-300 bg-white p-4 shadow-sm">
          <p className="font-semibold text-zinc-900">Sell {machineTitle(m)}{m.key_number ? ` (key ${m.key_number})` : ""}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex flex-col text-xs text-zinc-500">Date sold<input type="date" value={sv.sold_at} max={todayNZ()} onChange={setS("sold_at")} className={input} /></label>
            {owner && <label className="flex flex-col text-xs text-zinc-500">Sold for, incl GST<input value={sv.price} onChange={setS("price")} inputMode="decimal" placeholder="e.g. 6499" className={input} /></label>}
            {r.for_sale_at && <p className="self-end pb-2 text-xs text-zinc-500">Up for sale {nzDate(r.for_sale_at)}</p>}
          </div>
          <h3 className="mt-3 text-sm font-semibold text-zinc-800">Buyer</h3>
          {picked ? (
            <p className="mt-1 flex items-center gap-3 text-sm text-zinc-800">
              {picked.name}{picked.phone ? ` · ${picked.phone}` : ""}
              <button type="button" onClick={() => setSv((v) => ({ ...v, customer_id: "" }))} className="text-zinc-500 underline">change</button>
            </p>
          ) : (
            <>
              <input value={sv.cq} onChange={setS("cq")} placeholder="Already a customer? Search by name or phone" className={input + " mt-1"} />
              {found.length > 0 && (
                <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {found.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setSv((v) => ({ ...v, customer_id: c.id, cq: "" }))} className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50">
                        {c.name}{c.phone ? <span className="text-zinc-500"> · {c.phone}</span> : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-zinc-500">Or a new customer:</p>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input value={sv.name} onChange={setS("name")} placeholder="Name" className={input} />
                <input value={sv.phone} onChange={setS("phone")} placeholder="Phone" inputMode="tel" className={input} />
                <input value={sv.email} onChange={setS("email")} placeholder="Email" inputMode="email" className={input} />
              </div>
              <input value={sv.address} onChange={setS("address")} placeholder="Address" className={input + " mt-2"} />
            </>
          )}
          {(picked ? !picked.email : !sv.email.trim()) && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No email: {picked ? `${picked.name} won't` : "they won't"} get the automatic service reminder. They&apos;ll show on the Due list to phone instead.
              {picked && <> Add an email on their <Link href={`/customers/${picked.id}`} className="underline">customer page</Link>.</>}
            </p>
          )}
          <textarea value={sv.notes} onChange={setS("notes")} rows={2} placeholder="Notes (e.g. trade-in, warranty, what was agreed)" className={input + " mt-3"} />
          <p className="mt-2 text-xs text-zinc-500">The bike moves to the buyer&apos;s name, with a service reminder due {sv.sold_at ? nzDate(plusYear(sv.sold_at)) : "12 months after the sale"}.{r.listing && r.listing.status === "Available" ? " The website listing changes to Sold." : ""}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => sellIt(r)} disabled={busy === r.id} className={saveBtn}>{busy === r.id ? "Saving…" : "Mark as sold"}</button>
            <button onClick={() => { setSellId(null); setSv(BLANK_SALE); }} className={cancelBtn}>Cancel</button>
          </div>
        </li>
      );
    }
    return (
      <li key={r.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-zinc-900">
              {machineTitle(m)}
              {m.key_number && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-700">Key {m.key_number}</span>}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {r.came_in ? `In ${nzDate(r.came_in)}` : "No date in"}
              {r.hire ? ` · ${r.stage === "On hire" ? "with" : "pick up from"} ${r.hire.name}` : ""}
              {r.for_sale_at ? ` · up for sale ${nzDate(r.for_sale_at)}` : ""}
              {r.sold_at ? ` · sold ${nzDate(r.sold_at)}` : ""}
              {r.sold_at && r.for_sale_at ? ` (${daysBetween(r.for_sale_at, r.sold_at)} days)` : ""}
            </p>
            {r.stage === "Sold" && (r.buyer || (owner && r.sold_price !== null)) && (
              <p className="mt-0.5 text-sm text-zinc-700">
                {r.buyer && <>To <Link href={`/customers/${r.buyer.id}`} className="font-medium text-red-600 hover:underline">{r.buyer.name}</Link>{r.buyer.phone ? ` · ${r.buyer.phone}` : ""}</>}
                {owner && r.sold_price !== null && <span className="font-semibold">{r.buyer ? " · " : ""}sold for {money(r.sold_price)}</span>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {r.asking_price !== null && <span className="text-sm font-semibold text-zinc-900">{money(r.asking_price)}</span>}
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STAGE_STYLE[r.stage] || ""}`}>{r.stage}</span>
          </div>
        </div>
        {r.work_done && <p className="mt-2 text-sm text-zinc-700">{r.work_done}</p>}
        {r.to_do && <p className="mt-1 text-sm font-medium text-amber-800">To do: {r.to_do}</p>}
        {r.notes && <p className="mt-1 text-xs text-zinc-500">{r.notes}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-1.5 text-zinc-700"><input type="checkbox" checked={!!r.ready} onChange={() => toggleReady(r)} className="h-4 w-4" /> Ready</label>
          {r.job && <Link href={`/jobs/${r.job.id}`} className="font-medium text-red-600 hover:underline">Job #{r.job.job_number} · {r.job.status === "Ready" ? "with Craig" : r.job.status}</Link>}
          {r.listing
            ? <span className="text-emerald-700">{r.listing.status === "Available" ? "On the website" : "Website: sold"}{owner && <> · <Link href="/secondhand" className="underline">photos</Link></>}</span>
            : owner && r.stage !== "Sold" && (listFor === r.id ? (
              <span className="flex items-center gap-2">
                <select value={listCat} onChange={(e) => setListCat(e.target.value)} className="rounded-lg border border-zinc-300 px-2 py-1 text-sm">
                  <option value="">Category…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <button onClick={() => listOnWebsite(r)} disabled={busy === r.id} className="font-medium text-emerald-700 underline">Put it up</button>
                <button onClick={() => setListFor(null)} className="text-zinc-500 underline">cancel</button>
              </span>
            ) : (
              <button onClick={() => { setListFor(r.id); setListCat(""); }} className="font-medium text-emerald-700 hover:underline">List on website</button>
            ))}
          {r.stage !== "Sold" && <button onClick={() => startSell(r)} className="ml-auto font-medium text-emerald-700 hover:underline">Mark as sold</button>}
          <button onClick={() => startEdit(r)} className={(r.stage === "Sold" ? "ml-auto " : "") + "font-medium text-zinc-600 hover:underline"}>Edit</button>
          {owner && r.stage !== "Sold" && removeId !== r.id && (
            <button onClick={() => { setRemoveId(r.id); setError(null); setNote(null); }} className="font-medium text-red-600 hover:underline">Remove</button>
          )}
        </div>
        {removeId === r.id && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-medium">Remove {machineTitle(m)}{m.key_number ? ` (key ${m.key_number})` : ""} from stock?</p>
            <p className="mt-1 text-red-800">This can&apos;t be undone.{r.job ? " The machine stays on file because it has a workshop job." : ""}{r.listing ? " It's on the website, so take it off the For Sale page first." : ""}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => removeIt(r)} disabled={busy === r.id} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">{busy === r.id ? "Removing…" : "Yes, remove it"}</button>
              <button onClick={() => setRemoveId(null)} className={cancelBtn}>Cancel</button>
            </div>
          </div>
        )}
      </li>
    );
  }

  const live = STAGES.filter((s) => s !== "Sold");
  const sold = shown.filter((r) => r.stage === "Sold");

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Stock</h1>
          <p className="mt-1 text-zinc-600">Our own machines, from hire to sale.</p>
        </div>
        <button onClick={() => { setAdding(true); setError(null); }} className={btn + " shrink-0 whitespace-nowrap"}>+ Add machine</button>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model, key number, notes…" className={input + " mt-4"} />
      {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {note && !error && <p className="mt-3 text-sm text-emerald-700">{note}</p>}

      {adding && (
        <form onSubmit={addMachine} className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-zinc-900">Add a machine to stock</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input value={nv.type} onChange={setN("type")} placeholder="Type (ATV, SxS…)" className={input} />
            <input value={nv.make} onChange={setN("make")} placeholder="Make" className={input} />
            <input value={nv.model} onChange={setN("model")} placeholder="Model" className={input} />
            <input value={nv.year} onChange={setN("year")} placeholder="Year" inputMode="numeric" className={input} />
            <input value={nv.key_number} onChange={setN("key_number")} placeholder="Key number" className={input} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <select value={nv.stage} onChange={setN("stage")} className={input}>{STAGES.filter((s) => s !== "Sold").map((s) => <option key={s}>{s}</option>)}</select>
            <input type="date" value={nv.came_in} onChange={setN("came_in")} className={input} />
            {owner && <input value={nv.asking_price} onChange={setN("asking_price")} placeholder="Price incl GST (optional)" inputMode="decimal" className={input} />}
          </div>
          <textarea value={nv.work_done} onChange={setN("work_done")} rows={2} placeholder="Work done" className={input + " mt-2"} />
          <textarea value={nv.to_do} onChange={setN("to_do")} rows={2} placeholder="Still to do" className={input + " mt-2"} />
          {matches && matches.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Key {nv.key_number.trim()} is already on file. Is it one of these?</p>
              <ul className="mt-2 space-y-2">
                {matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2">
                    <span>
                      <span className="font-medium">{machineTitle(m)}</span>
                      {m.owner && <span className="text-zinc-600"> · {m.owner}</span>}
                      {m.job && <span className="text-zinc-600"> · job #{m.job.job_number} ({m.job.status})</span>}
                    </span>
                    {m.stock
                      ? <span className="text-xs font-medium text-amber-800">Already in stock ({m.stock.stage})</span>
                      : <button type="button" onClick={() => pickExisting(m)} disabled={busy === "add"} className={saveBtn}>Use this one</button>}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={createNew} disabled={busy === "add"} className={cancelBtn}>No, it's a different machine. Add new</button>
                <button type="button" onClick={closeAdd} className={cancelBtn}>Cancel</button>
              </div>
            </div>
          )}
          {!(matches && matches.length > 0) && (
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={busy === "add"} className={saveBtn}>{busy === "add" ? "Checking…" : "Add"}</button>
              <button type="button" onClick={closeAdd} className={cancelBtn}>Cancel</button>
            </div>
          )}
        </form>
      )}

      {loading ? (
        <p className="mt-6 text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-6 text-center text-zinc-500">No stock yet. Tap “+ Add machine” to start.</p>
      ) : (
        <>
          {live.map((stage) => {
            const list = shown.filter((r) => r.stage === stage);
            if (!list.length) return null;
            return (
              <section key={stage}>
                <h2 className="mt-6 mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {stage}<span className="font-normal normal-case tracking-normal text-zinc-400">({list.length})</span>
                </h2>
                <ul className="flex flex-col gap-3">{list.map((r) => renderRow(r))}</ul>
              </section>
            );
          })}
          {sold.length > 0 && (
            <>
              <button onClick={() => setShowSold((v) => !v)} className="mt-6 mb-2 flex w-full items-baseline gap-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-700">
                Sold<span className="font-normal normal-case tracking-normal text-zinc-400">({sold.length})</span>
                <span className="ml-auto font-normal normal-case tracking-normal text-zinc-400">{showSold ? "hide" : "show"}</span>
              </button>
              {showSold && <ul className="flex flex-col gap-3">{sold.map((r) => renderRow(r))}</ul>}
            </>
          )}
        </>
      )}
    </main>
  );
}
