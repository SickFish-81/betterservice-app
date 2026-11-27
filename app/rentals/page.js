"use client";

// Betterservice — Rentals
// The ten small units, the large shed, the sign space and the car parks, and
// who is in each one.
//
// CAR PARKS (27 Nov 2026, migrations 0097 and 0098). A car park is a rental
// unit with kind = 'car_park'. Its charge is MONTHLY by default (Ben: "default
// to monthly like all the other invoices he can still adjust"), or every so
// many days instead: 7 for weekly, 3 for a short stay. The rate box holds the
// charge for one of those periods.
//
// Car parks are billed IN ARREARS: each invoice is made the day after a period
// ends, for what was used. "Stop" (Ben: "Craig should be able to 'stop' the
// rental on the spot, and it charge up to that time") ends the parking today
// and makes the last invoice there and then, for the days so far: 3 days of a
// $50 week is $21.42. stop_rental() in the database does the work; this page
// then files the invoice's PDF, so it's ready under Awaiting approval.
//
// The rent held here is what the tenant actually pays: GST-INCLUSIVE, because
// that is what their automatic payment is set to. The invoice generator
// extracts the GST at 3/23 rather than adding 15% on top — the opposite of a
// job card, where prices are held ex-GST. The split is shown live under the
// rent box so there is no guessing about which number goes in.

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import Hireage from "./Hireage";
import Approvals from "./Approvals";

const input = "w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100";
const btn = "rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white transition hover:bg-red-700";

const money = (n) => "$" + Number(n || 0).toFixed(2);
const gstOf = (inc) => Math.round(Number(inc || 0) * 3 / 23 * 100) / 100;
const nzDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ") : "");

const empty = { unit_id: "", customer_id: "", monthly_rate_incl_gst: "", power_charge_incl_gst: "", cp_mode: "month", period_days: "7", start_date: "", end_date: "", on_hold: false, notes: "" };

const isCarPark = (u) => u?.kind === "car_park";
// "every 7 days" reads as "every week" to anyone glancing at it.
// null (monthly) reads as "month"; 7 days as "week".
const everyLabel = (days) => (!days ? "month" : Number(days) === 7 ? "week" : Number(days) === 1 ? "day" : `${days} days`);
// Today in New Zealand. The ISO date in the browser is UTC, which is still
// yesterday until 1pm in summer, and a stop has to charge up to NZ today.
const nzToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
// d + n months the way Postgres does it: 31 Jan + 1 month = 28 Feb.
const addMonths = (d, n) => {
  const [y, m, day] = d.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
};

export default function RentalsPage() {
  const [units, setUnits] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("units");
  const [newUnit, setNewUnit] = useState({ name: "", description: "" });
  const [addingUnit, setAddingUnit] = useState(null); // null, "unit" or "car_park"
  const unitById = (id) => units.find((u) => u.id === id);
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState(null);
  const [stopping, setStopping] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // How many rent invoices are prepared but not yet sent. Shown on the tab so
  // it is visible without going looking — an approval queue nobody opens is
  // just a slower way of not invoicing.
  useEffect(() => {
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("kind", "rental")
      .eq("sent", false)
      .then(({ count }) => setPending(count || 0));
  }, [tab]);

  async function load() {
    setLoading(true);
    const [u, a, c] = await Promise.all([
      supabase.from("rental_units").select("*").order("name"),
      supabase.from("rental_agreements").select("*, customers(name), rental_units(name, kind)"),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    if (u.error || a.error || c.error) setError((u.error || a.error || c.error).message);
    else { setUnits(u.data || []); setAgreements(a.data || []); setCustomers(c.data || []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // The tenancy that matters for a unit: the one running today, or if none has
  // started yet, the next one due. A tenancy signed for next month is NOT a
  // vacant unit — showing it as vacant is how a unit gets double-let.
  const today = new Date().toISOString().slice(0, 10);
  const currentFor = (unitId) => {
    const live = agreements
      .filter((a) => a.unit_id === unitId && (!a.end_date || a.end_date >= today))
      .sort((x, y) => String(x.start_date).localeCompare(String(y.start_date)));
    return live.find((a) => a.start_date <= today) || live[0] || null;
  };

  function startEdit(a) {
    setEditingId(a.id);
    setForm({
      unit_id: a.unit_id, customer_id: a.customer_id,
      monthly_rate_incl_gst: String(a.monthly_rate_incl_gst ?? ""),
      power_charge_incl_gst: a.power_charge_incl_gst ? String(a.power_charge_incl_gst) : "",
      cp_mode: a.period_days ? "days" : "month",
      period_days: a.period_days ? String(a.period_days) : "7",
      start_date: a.start_date || "", end_date: a.end_date || "",
      on_hold: !!a.on_hold, notes: a.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function cancelEdit() { setEditingId(null); setForm(empty); }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (!form.unit_id) return setError("Pick a unit or car park.");
    if (!form.customer_id) return setError("Pick the tenant. Add them under Customers first if they're not listed.");
    const parking = isCarPark(unitById(form.unit_id));
    // null = monthly. Only a car park set to "every so many days" has a number.
    const days = parking && form.cp_mode === "days" ? Number(form.period_days) : null;
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 90)) return setError("Charge every: a whole number of days, 1 to 90 (7 for weekly).");
    const rate = Number(form.monthly_rate_incl_gst);
    if (!(rate > 0)) return setError(parking ? `Enter what they pay each ${everyLabel(days)}.` : "Enter the monthly rent the tenant pays.");
    const power = form.power_charge_incl_gst === "" ? 0 : Number(form.power_charge_incl_gst);
    if (!Number.isFinite(power) || power < 0) return setError("Power charge must be a number, or leave it blank.");
    if (!form.start_date) return setError("Enter the date the tenancy starts.");
    if (form.end_date && form.end_date < form.start_date) return setError("The end date can't be before the start date.");
    // Deliberately a confirm, not a hard stop — an odd rate can be legitimate
    // (the sign space isn't a storage unit). It just has to be said out loud.
    if (rateWarning && !window.confirm(rateWarning + "\n\nSave this rate anyway?")) return;

    const payload = {
      unit_id: form.unit_id,
      customer_id: form.customer_id,
      monthly_rate_incl_gst: rate,
      // A car park has no power, and is billed by days; a unit is monthly.
      power_charge_incl_gst: parking ? 0 : Number(form.power_charge_incl_gst) || 0,
      period_days: days,
      in_arrears: parking,
      start_date: form.start_date,
      end_date: form.end_date || null,
      on_hold: !!form.on_hold,
      notes: form.notes || null,
    };
    const { error } = editingId
      ? await supabase.from("rental_agreements").update(payload).eq("id", editingId)
      : await supabase.from("rental_agreements").insert(payload);
    if (error) { setError(error.message); return; }
    cancelEdit();
    load();
  }

  // Only for a tenancy entered by mistake. One that has ever been invoiced is
  // refused by the database — its invoices point at it, and deleting it would
  // orphan them. End-date it instead.
  async function removeAgreement(a) {
    if (!window.confirm(`Delete this tenancy for ${a.rental_units?.name || "this unit"}?\n\nUse this only for a mistake. To end a real tenancy, set an end date instead so the history is kept.`)) return;
    const { error } = await supabase.from("rental_agreements").delete().eq("id", a.id);
    if (error) {
      setError(error.message.includes("foreign key") || error.message.includes("violates")
        ? "This tenancy has invoices against it, so it can't be deleted. Set an end date instead."
        : error.message);
      return;
    }
    setError(null);
    load();
  }

  async function addUnit(e) {
    e.preventDefault();
    setError(null);
    const name = newUnit.name.trim();
    const kind = addingUnit === "car_park" ? "car_park" : "unit";
    if (!name) return setError(kind === "car_park" ? "Give the car park a name, e.g. Car park 1." : "Give the unit a name.");
    const { error } = await supabase.from("rental_units")
      .insert({ name, kind, description: newUnit.description.trim() || null });
    if (error) {
      setError(error.message.includes("duplicate") || error.message.includes("unique")
        ? `There's already a unit or car park called "${name}".`
        : error.message);
      return;
    }
    setNewUnit({ name: "", description: "" });
    setAddingUnit(null);
    load();
  }

  // Retiring a unit keeps its history — the tenancies and invoices that ran
  // through it stay exactly where they are, it just stops being offered.
  async function toggleUnitActive(u) {
    const { error } = await supabase.from("rental_units").update({ active: !u.active }).eq("id", u.id);
    if (error) setError(error.message);
    load();
  }

  // What a stop will charge for the period running today, worked out the same
  // way the database does, so Craig sees the figure before he presses it.
  function stopPreview(a) {
    const t = nzToday();
    let ps, end;
    if (a.period_days) {
      const n = Number(a.period_days);
      ps = addDays(a.start_date, Math.floor(daysBetween(a.start_date, t) / n) * n);
      end = addDays(ps, n - 1);
    } else {
      let k = 0;
      while (addMonths(a.start_date, k + 1) <= t) k++;
      ps = addMonths(a.start_date, k);
      end = addDays(addMonths(a.start_date, k + 1), -1);
    }
    const days = daysBetween(ps, end) + 1;   // this period's length: the days in THIS month
    const used = daysBetween(ps, t) + 1;
    const rate = Number(a.monthly_rate_incl_gst) || 0;
    return { days, used, label: everyLabel(a.period_days), amount: used < days ? Math.round(rate * used / days * 100) / 100 : rate };
  }

  async function stopParking(u, a) {
    const who = a.customers?.company_name || a.customers?.name || "this tenant";
    const p = stopPreview(a);
    const charge = p.used < p.days
      ? `${p.used} of ${p.days} days, about ${money(p.amount)}`
      : `the full ${p.label}, ${money(p.amount)}`;
    if (!window.confirm(
      `Stop ${u.name} for ${who} now?\n\nThey'll be charged up to today: ${charge}. Any earlier period not invoiced yet goes on too.\n\nThe invoice waits under Awaiting approval for you to check and send.`
    )) return;
    setError(null); setNotice(null); setStopping(a.id);
    const { data: made, error } = await supabase.rpc("stop_rental", { p_agreement_id: a.id });
    if (error) { setStopping(null); setError(error.message); return; }

    // File each new invoice's PDF now, so it can be approved straight away
    // rather than after tonight's run.
    const { data: { session } } = await supabase.auth.getSession();
    const unfiled = [];
    for (const inv of made || []) {
      const { data: res, error: fErr } = await supabase.functions.invoke("generate-rental-invoices", {
        body: { rebuildInvoiceId: inv.id, accessToken: session?.access_token || null },
      });
      if (fErr || res?.error) unfiled.push("#" + String(inv.invoice_number).padStart(5, "0"));
    }
    setStopping(null);
    const total = (made || []).reduce((t, i) => t + Number(i.total || 0), 0);
    setNotice(
      (made || []).length === 0
        ? `${u.name} stopped. There was nothing left to charge.`
        : `${u.name} stopped. ${(made || []).length === 1 ? "Invoice" : (made || []).length + " invoices"} for ${money(total)} waiting under Awaiting approval.` +
          (unfiled.length ? ` The PDF for ${unfiled.join(", ")} didn't build; tonight's run will file it.` : "")
    );
    load();
  }

  async function toggleHold(a) {
    const { error } = await supabase.from("rental_agreements").update({ on_hold: !a.on_hold }).eq("id", a.id);
    if (error) setError(error.message);
    load();
  }

  const formParking = isCarPark(unitById(form.unit_id));
  const formDays = formParking && form.cp_mode === "days" ? Number(form.period_days) || 7 : null;
  const rate = Number(form.monthly_rate_incl_gst) || 0;
  const powerAmt = formParking ? 0 : Number(form.power_charge_incl_gst) || 0;
  const billTotal = rate + powerAmt;
  const gst = billTotal > 0 ? gstOf(billTotal) : 0;

  // A rent wildly out of line with the other units is almost always a typo, and
  // the usual typo is a WEEKLY figure typed into a monthly box — which is exactly
  // how Unit 3 was invoiced at $115 for a month whose rent is $498.33. The
  // generator can't catch it: $115 is a perfectly valid number. Catching it has
  // to happen here, while the person who knows the real rent is looking at it.
  //
  // Only like is compared with like: a unit's rent with the other units', and a
  // car park's charge with car parks billed over the same number of days. A
  // week's parking next to a month's rent would always look wrong.
  const peerRates = agreements
    .filter((a) => a.id !== editingId && Number(a.monthly_rate_incl_gst) > 0)
    .filter((a) => formParking
      ? a.rental_units?.kind === "car_park" && (a.period_days ?? null) === formDays
      : a.rental_units?.kind !== "car_park")
    .map((a) => Number(a.monthly_rate_incl_gst))
    .sort((x, y) => x - y);
  const peerMedian = peerRates.length ? peerRates[Math.floor(peerRates.length / 2)] : 0;
  const asMonthly = (rate * 52) / 12;           // what this would be, if it were a week's rent
  const looksWeekly = !formParking && peerMedian > 0 && rate > 0 && Math.abs(asMonthly - peerMedian) <= peerMedian * 0.15;
  const wayOff = peerMedian > 0 && rate > 0 && (rate < peerMedian * 0.6 || rate > peerMedian * 1.6);
  const rateWarning = !wayOff
    ? null
    : looksWeekly
      ? `${money(rate)} looks like a WEEKLY rent. The other units are around ${money(peerMedian)} a month — and ${money(rate)} a week works out to ${money(asMonthly)} a month.`
      : formParking
        ? `${money(rate)} is a long way from the other car parks, which are around ${money(peerMedian)} every ${everyLabel(formDays)}.`
        : `${money(rate)} is a long way from the other units, which are around ${money(peerMedian)} a month.`;
  const plainUnits = units.filter((u) => !isCarPark(u));
  const carParks = units.filter(isCarPark);
  const vacantIn = (list) => list.filter((u) => !currentFor(u.id)).length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Rentals</h1>
      <p className="mt-1 text-zinc-600">
        {tab === "units"
          ? "The storage units, the shed and the car parks. Units are invoiced monthly, three days before each month starts. Car parks are invoiced after each month (or every so many days, if set) for the days used, and Stop charges up to today. Every invoice waits under Awaiting approval until Craig sends it."
          : "Gear hired out by the day. Paid when it goes out or comes back, not on account."}
      </p>

      <div className="mt-5 flex gap-1 border-b border-zinc-200">
        {[["units", "Units & car parks"], ["hireage", "Hireage"], ["approvals", pending ? `Awaiting approval (${pending})` : "Awaiting approval"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={"-mb-px border-b-2 px-4 py-2 text-sm font-medium " +
              (tab === k ? "border-red-600 text-red-700" : "border-transparent text-zinc-500 hover:text-zinc-800")}>
            {lbl}
          </button>
        ))}
      </div>

      {tab === "hireage" && <Hireage />}
      {tab === "approvals" && <Approvals />}
      {tab === "units" && (
      <>

      <form onSubmit={save} className="mt-6 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-zinc-900">{editingId ? "Edit tenancy" : "New tenancy"}</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select value={form.unit_id} onChange={set("unit_id")} className={input}>
            <option value="">Which unit or car park…</option>
            <optgroup label="Units">
              {plainUnits.filter((u) => u.active || u.id === form.unit_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </optgroup>
            {carParks.length > 0 && (
              <optgroup label="Car parks">
                {carParks.filter((u) => u.active || u.id === form.unit_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
          </select>
          <select value={form.customer_id} onChange={set("customer_id")} className={input}>
            <option value="">Which tenant…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <p className="-mt-1 text-xs text-zinc-500">
          Tenant not listed? <Link href="/customers" className="underline hover:text-zinc-700">Add them under Customers</Link> first.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {formParking ? (
            <>
              <label className="text-xs font-medium text-zinc-600">Charge
                <div className="flex gap-2">
                  <select value={form.cp_mode} onChange={set("cp_mode")} className={input}>
                    <option value="month">Monthly</option>
                    <option value="days">Every … days</option>
                  </select>
                  {form.cp_mode === "days" && (
                    <input value={form.period_days} onChange={set("period_days")} type="number" step="1" min="1" max="90"
                           placeholder="7" aria-label="Number of days" className={input + " max-w-[6rem]"} />
                  )}
                </div>
              </label>
              <label className="text-xs font-medium text-zinc-600">Charge each {everyLabel(formDays)} (GST inclusive)
                <input value={form.monthly_rate_incl_gst} onChange={set("monthly_rate_incl_gst")} type="number" step="0.01" min="0"
                       placeholder="what they pay" className={input} />
              </label>
            </>
          ) : (
            <>
              <label className="text-xs font-medium text-zinc-600">Monthly rent (GST inclusive)
                <input value={form.monthly_rate_incl_gst} onChange={set("monthly_rate_incl_gst")} type="number" step="0.01" min="0"
                       placeholder="what the tenant pays" className={input} />
              </label>
              <label className="text-xs font-medium text-zinc-600">Power each month (GST inclusive, optional)
                <input value={form.power_charge_incl_gst} onChange={set("power_charge_incl_gst")} type="number" step="0.01" min="0"
                       placeholder="leave blank if none" className={input} />
              </label>
            </>
          )}
        </div>
        {formParking && (
          <p className="-mt-1 text-xs text-zinc-500">
            Monthly unless you pick a number of days (7 = weekly). Charged after each period, for the days used. When they leave, press <strong>stop</strong> on the car park and they&apos;re charged up to today.
          </p>
        )}
        {billTotal > 0 && (
          <p className="-mt-1 text-xs text-zinc-500">
            Invoiced each {formParking ? everyLabel(formDays) : "month"}: {money(billTotal - gst)} + {money(gst)} GST = <span className="font-medium text-zinc-700">{money(billTotal)}</span>
            {powerAmt > 0 && <> · shown as two lines, rent {money(rate)} and power {money(powerAmt)}</>}
          </p>
        )}
        {rateWarning && (
          <p className="-mt-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="font-semibold">Check this rate.</span> {rateWarning}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-600">Starts
            <input value={form.start_date} onChange={set("start_date")} type="date" className={input} />
          </label>
          <label className="text-sm text-zinc-600">Ends (leave blank if ongoing)
            <input value={form.end_date} onChange={set("end_date")} type="date" className={input} />
          </label>
        </div>

        <input value={form.notes} onChange={set("notes")} placeholder="Notes (optional)" className={input} />

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" checked={form.on_hold} onChange={(e) => setForm((f) => ({ ...f, on_hold: e.target.checked }))} />
          On hold — don&apos;t invoice this one for now
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" className={btn}>{editingId ? "Save changes" : "Add tenancy"}</button>
          {editingId && <button type="button" onClick={cancelEdit} className="text-sm text-zinc-500 hover:underline">cancel</button>}
        </div>
      </form>

      {notice && <p className="mt-4 text-sm text-emerald-700">{notice}</p>}
      {error && <p className="mt-4 text-sm text-red-600">Error: {error}</p>}

      {[
        { kind: "unit", title: "The units", list: plainUnits, add: "+ add a unit", placeholder: "e.g. Unit 11, Sign Space", button: "Add unit" },
        { kind: "car_park", title: "Car parks", list: carParks, add: "+ add a car park", placeholder: "e.g. Car park 1", button: "Add car park" },
      ].map((sec) => (
      <div key={sec.kind} className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-semibold text-zinc-900">{sec.title}</h2>
          <div className="flex items-baseline gap-3">
            {sec.list.length > 0 && <p className="text-sm text-zinc-500">{sec.list.length - vacantIn(sec.list)} let · {vacantIn(sec.list)} vacant</p>}
            <button onClick={() => { setAddingUnit((v) => (v === sec.kind ? null : sec.kind)); setNewUnit({ name: "", description: "" }); setError(null); }} className="text-sm text-zinc-600 underline hover:text-zinc-900">
              {addingUnit === sec.kind ? "cancel" : sec.add}
            </button>
          </div>
        </div>

        {addingUnit === sec.kind && (
          <form onSubmit={addUnit} className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-zinc-600">Name
              <input value={newUnit.name} onChange={(e) => setNewUnit((v) => ({ ...v, name: e.target.value }))}
                     placeholder={sec.placeholder} className={input} />
            </label>
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-zinc-600">Description
              <input value={newUnit.description} onChange={(e) => setNewUnit((v) => ({ ...v, description: e.target.value }))}
                     placeholder="optional" className={input} />
            </label>
            <button type="submit" className="rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">{sec.button}</button>
          </form>
        )}

        {loading ? (
          <p className="mt-4 text-zinc-500">Loading…</p>
        ) : sec.list.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {sec.list.map((u) => {
              const a = currentFor(u.id);
              const upcoming = !!a && a.start_date > today;
              return (
                <li key={u.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900">
                      {u.name}
                      {a && <span className="text-zinc-400"> · </span>}
                      {a && <span>{a.customers?.company_name || a.customers?.name || "—"}</span>}
                      {a?.on_hold && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">on hold</span>}
                      {upcoming && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">from {nzDate(a.start_date)}</span>}
                      {!a && u.active && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500">vacant</span>}
                      {!u.active && <span className="ml-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold text-zinc-600">retired</span>}
                    </p>
                    <p className="truncate text-sm text-zinc-500">
                      {a
                        ? `${a.customers?.company_name ? a.customers?.name + " · " : ""}${money(Number(a.monthly_rate_incl_gst) + Number(a.power_charge_incl_gst || 0))}/${a.period_days ? everyLabel(a.period_days) : "month"}${a.in_arrears ? ", charged after" : ""}${Number(a.power_charge_incl_gst) > 0 ? ` (incl ${money(a.power_charge_incl_gst)} power)` : ""} · ${upcoming ? "starts" : "since"} ${nzDate(a.start_date)} · ${a.end_date ? "ends " + nzDate(a.end_date) : "open-ended"}`
                        : "No tenant"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    {a && a.in_arrears && a.start_date <= nzToday() && (!a.end_date || a.end_date > nzToday()) && (
                      <button onClick={() => stopParking(u, a)} disabled={stopping === a.id}
                              className="rounded-md border border-red-300 px-2 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                        {stopping === a.id ? "stopping…" : "stop"}
                      </button>
                    )}
                    {a && a.in_arrears && a.end_date === nzToday() && <span className="text-zinc-500">stopped today</span>}
                    {a && <button onClick={() => startEdit(a)} className="text-zinc-600 hover:underline">edit</button>}
                    {a && <button onClick={() => toggleHold(a)} className="text-zinc-600 hover:underline">{a.on_hold ? "resume" : "hold"}</button>}
                    {a && <button onClick={() => removeAgreement(a)} className="text-red-500 hover:underline">remove</button>}
                    {!a && <button onClick={() => toggleUnitActive(u)} className="text-zinc-600 hover:underline">{u.active ? "retire" : "reinstate"}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      ))}
      </>
      )}
    </main>
  );
}
